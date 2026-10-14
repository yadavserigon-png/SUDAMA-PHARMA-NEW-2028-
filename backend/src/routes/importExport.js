// Excel / CSV import (template -> upload -> preview with row errors -> confirm) and exports.
const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Supplier = require('../models/Supplier');
const Store = require('../models/Store');
const InventoryBatch = require('../models/InventoryBatch');
const Expense = require('../models/Expense');
const Order = require('../models/Order');
const Purchase = require('../models/Purchase');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { parseRange, toCalendarDate } = require('../utils/dates');
const { authenticate, requirePermission } = require('../middleware/auth');
const { storeFilter, canAccessStore } = require('../middleware/storeScope');
const { hasPermission, isStaff } = require('../config/roles');
const { sheetUpload } = require('../middleware/upload');
const { readRows, sendWorkbook } = require('../services/sheets');
const inventory = require('../services/inventory');
const { startOfDay } = require('../services/stockRules');

const router = express.Router();
router.use(authenticate);

const bool = (v) => ['yes', 'y', 'true', '1'].includes(String(v ?? '').trim().toLowerCase());
const num = (v) => (v === '' || v === undefined || v === null ? undefined : Number(String(v).replace(/,/g, '')));
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------- IMPORT DEFINITIONS ----------------
const IMPORTS = {
  categories: {
    perm: 'categories.manage',
    columns: ['name*', 'parent_name', 'description', 'discount_percent', 'sort_order', 'active'],
    async prepare(rows) {
      const cats = await Category.find({}).lean();
      const byName = new Map(cats.map((c) => [c.name.toLowerCase(), c]));
      return rows.map((r) => {
        if (!str(r.name)) return { error: 'name is required' };
        const parentName = str(r.parent_name);
        const parentInFile = parentName && rows.some((x) => str(x.name).toLowerCase() === parentName.toLowerCase());
        if (parentName && !byName.has(parentName.toLowerCase()) && !parentInFile) return { error: `parent "${parentName}" not found` };
        const d = num(r.discount_percent);
        if (d !== undefined && (Number.isNaN(d) || d < 0 || d > 90)) return { error: 'discount_percent must be 0-90' };
        const slug = slugify(r.name);
        return { key: slug, existing: cats.find((c) => c.slug === slug), data: { name: str(r.name), slug, parentName, description: str(r.description) || undefined, discountPercent: d, sortOrder: num(r.sort_order), active: r.active === undefined || r.active === '' ? true : bool(r.active) } };
      });
    },
    async apply(item) {
      const { parentName, ...data } = item.data;
      if (parentName) data.parent = (await Category.findOne({ name: new RegExp(`^${parentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean())?._id;
      if (item.existing) await Category.updateOne({ _id: item.existing._id }, data, { runValidators: true });
      else await Category.create(data);
    },
  },

  products: {
    perm: 'products.manage',
    columns: ['sku*', 'name*', 'mrp*', 'barcodes (separate with |)', 'generic_name', 'brand', 'manufacturer', 'marketer', 'composition', 'strength', 'dosage_form', 'pack_size', 'units_per_strip', 'strips_per_box', 'category', 'subcategory', 'retail_price', 'wholesale_price', 'purchase_cost', 'gst_rate', 'hsn_code', 'discount_percent', 'prescription_required', 'schedule_class', 'min_wholesale_qty', 'low_stock_threshold', 'data_verified', 'active'],
    async prepare(rows) {
      const cats = await Category.find({}).lean();
      const catBy = (v) => cats.find((c) => c.name.toLowerCase() === str(v).toLowerCase() || c.slug === slugify(v));
      const skus = rows.map((r) => str(r.sku).toUpperCase()).filter(Boolean);
      const existing = new Map((await Product.find({ sku: { $in: skus } }).lean()).map((p) => [p.sku, p]));
      const allBarcodes = rows.flatMap((r) => str(r.barcodes || r.barcodes_separate_with || r.barcode).split('|').map((b) => b.trim()).filter(Boolean));
      const barcodeOwners = new Map((await Product.find({ barcodes: { $in: allBarcodes } }).select('sku barcodes').lean()).flatMap((p) => p.barcodes.map((b) => [b, p.sku])));
      return rows.map((r) => {
        const sku = str(r.sku).toUpperCase();
        if (!sku) return { error: 'sku is required' };
        if (!str(r.name)) return { error: 'name is required' };
        const mrp = num(r.mrp);
        if (mrp === undefined || Number.isNaN(mrp) || mrp < 0) return { error: 'mrp must be a number' };
        const retail = num(r.retail_price);
        if (retail !== undefined && retail > mrp) return { error: 'retail_price cannot exceed mrp' };
        const wholesale = num(r.wholesale_price);
        if (wholesale !== undefined && wholesale > mrp) return { error: 'wholesale_price cannot exceed mrp' };
        const gst = num(r.gst_rate);
        if (gst !== undefined && ![0, 5, 12, 18, 28].includes(gst)) return { error: 'gst_rate must be 0, 5, 12, 18 or 28' };
        const barcodes = str(r.barcodes || r.barcodes_separate_with || r.barcode).split('|').map((b) => b.trim()).filter(Boolean);
        for (const b of barcodes) {
          const owner = barcodeOwners.get(b);
          if (owner && owner !== sku) return { error: `barcode ${b} already belongs to ${owner}` };
        }
        const cat = r.category ? catBy(r.category) : undefined;
        if (r.category && !cat) return { error: `category "${r.category}" not found - import categories first` };
        const sub = r.subcategory ? catBy(r.subcategory) : undefined;
        if (r.subcategory && !sub) return { error: `subcategory "${r.subcategory}" not found` };
        const sched = str(r.schedule_class) || undefined;
        if (sched && !['none', 'otc', 'G', 'H', 'H1', 'X', 'narcotic', 'not_for_online'].includes(sched)) return { error: 'invalid schedule_class' };
        const data = {
          sku, name: str(r.name), mrp, genericName: str(r.generic_name) || undefined, brand: str(r.brand) || undefined, manufacturer: str(r.manufacturer) || undefined,
          marketer: str(r.marketer) || undefined, composition: str(r.composition) || undefined, strength: str(r.strength) || undefined, dosageForm: str(r.dosage_form) || undefined,
          packSize: str(r.pack_size) || undefined, unitsPerStrip: num(r.units_per_strip), stripsPerBox: num(r.strips_per_box), category: cat?._id, subcategory: sub?._id,
          retailPrice: retail, wholesalePrice: wholesale, purchaseCost: num(r.purchase_cost), gstRate: gst, hsnCode: str(r.hsn_code) || undefined, discountPercent: num(r.discount_percent),
          prescriptionRequired: r.prescription_required === undefined || r.prescription_required === '' ? undefined : bool(r.prescription_required), scheduleClass: sched,
          minWholesaleQty: num(r.min_wholesale_qty), lowStockThreshold: num(r.low_stock_threshold), dataVerified: r.data_verified === '' || r.data_verified === undefined ? undefined : bool(r.data_verified),
          active: r.active === undefined || r.active === '' ? undefined : bool(r.active), barcodes,
        };
        Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
        return { key: sku, existing: existing.get(sku), data };
      });
    },
    async apply(item) {
      if (item.existing) {
        const p = await Product.findById(item.existing._id);
        const { barcodes, ...rest } = item.data;
        Object.assign(p, rest);
        p.barcodes = [...new Set([...(p.barcodes || []), ...(barcodes || [])])];
        await p.save();
      } else await Product.create(item.data);
    },
  },

  barcodes: {
    perm: 'barcodes.register',
    columns: ['sku*', 'barcode*'],
    async prepare(rows) {
      return Promise.all(rows.map(async (r) => {
        const sku = str(r.sku).toUpperCase();
        const code = str(r.barcode);
        if (!sku || !code) return { error: 'sku and barcode are required' };
        const p = await Product.findOne({ sku }).lean();
        if (!p) return { error: `sku ${sku} not found` };
        const owner = await Product.findOne({ barcodes: code }).select('sku').lean();
        if (owner && owner.sku !== sku) return { error: `barcode already mapped to ${owner.sku}` };
        return { key: `${sku}|${code}`, existing: owner ? p : undefined, data: { productId: p._id, code } };
      }));
    },
    async apply(item) {
      await Product.updateOne({ _id: item.data.productId }, { $addToSet: { barcodes: item.data.code } });
    },
  },

  suppliers: {
    perm: 'suppliers.manage',
    columns: ['name*', 'code', 'contact_person', 'phone', 'email', 'gstin', 'drug_license_no', 'address', 'city', 'district', 'pincode', 'payment_terms_days'],
    async prepare(rows) {
      const all = await Supplier.find({}).lean();
      return rows.map((r) => {
        if (!str(r.name)) return { error: 'name is required' };
        const code = str(r.code).toUpperCase() || undefined;
        const gstin = str(r.gstin).toUpperCase() || undefined;
        if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) return { error: 'gstin must be 15 characters' };
        const existing = all.find((s) => (code && s.code === code) || (gstin && s.gstin === gstin));
        return { key: code || gstin || str(r.name).toLowerCase(), existing, data: { name: str(r.name), code, contactPerson: str(r.contact_person) || undefined, phone: str(r.phone) || undefined, email: str(r.email) || undefined, gstin, drugLicenseNo: str(r.drug_license_no) || undefined, address: { line1: str(r.address) || undefined, city: str(r.city) || undefined, district: str(r.district) || undefined, pincode: str(r.pincode) || undefined }, paymentTermsDays: num(r.payment_terms_days) } };
      });
    },
    async apply(item) {
      if (item.existing) await Supplier.updateOne({ _id: item.existing._id }, item.data, { runValidators: true });
      else await Supplier.create(item.data);
    },
  },

  inventory: {
    perm: 'inventory.manage',
    columns: ['store_code*', 'sku*', 'batch_no*', 'expiry_date* (YYYY-MM-DD or YYYY-MM)', 'quantity* (sellable units to ADD)', 'mrp*', 'mfg_date', 'purchase_rate'],
    note: 'Inventory import only ADDS stock (opening stock / receipts). It never overwrites quantities. Rows for a batch that already exists are added on top only after you confirm.',
    async prepare(rows, user) {
      const stores = await Store.find({}).lean();
      const today = startOfDay(new Date());
      return Promise.all(rows.map(async (r) => {
        const store = stores.find((s) => s.code === str(r.store_code).toUpperCase());
        if (!store) return { error: `store_code ${r.store_code} not found` };
        if (!canAccessStore(user, store._id)) return { error: `no access to store ${store.code}` };
        const product = await Product.findOne({ sku: str(r.sku).toUpperCase() }).lean();
        if (!product) return { error: `sku ${r.sku} not found` };
        const batchNo = str(r.batch_no).toUpperCase();
        if (!batchNo) return { error: 'batch_no is required' };
        const expRaw = str(r.expiry_date || r.expiry_date_yyyy_mm_dd_or_yyyy_mm);
        const exp = toCalendarDate(expRaw);
        if (!expRaw || !(exp instanceof Date) || Number.isNaN(exp.getTime())) return { error: 'expiry_date is invalid' };
        if (exp <= today) return { error: 'batch is already expired - do not import as sellable stock' };
        const qty = num(r.quantity ?? r.quantity_sellable_units_to_add);
        if (!Number.isInteger(qty) || qty <= 0) return { error: 'quantity must be a positive whole number' };
        const mrp = num(r.mrp);
        if (mrp === undefined || Number.isNaN(mrp) || mrp <= 0) return { error: 'mrp is required' };
        if (product.retailPrice > mrp) return { error: `batch MRP ₹${mrp} is below the product selling price ₹${product.retailPrice}` };
        const existing = await InventoryBatch.findOne({ store: store._id, product: product._id, batchNo }).lean();
        if (existing && existing.expiryDate.getTime() !== exp.getTime()) return { error: `batch ${batchNo} exists with a different expiry` };
        return { key: `${store.code}|${product.sku}|${batchNo}`, existing, data: { store: store._id, product: product._id, batchNo, expiryDate: expRaw, mfgDate: str(r.mfg_date) || undefined, qty, mrp, purchaseRate: num(r.purchase_rate) || 0 } };
      }));
    },
    async apply(item, user) {
      await inventory.addStock({ ...item.data, source: 'import', movementType: 'opening', user: user._id, note: 'Excel import' });
    },
  },

  expenses: {
    perm: 'expenses.manage',
    columns: ['store_code*', 'date* (YYYY-MM-DD)', 'category*', 'amount*', 'vendor', 'payment_method', 'reference', 'notes'],
    note: `Categories: ${Expense.CATEGORIES.join(', ')}. Imported expenses start as "pending" and must be approved.`,
    async prepare(rows, user) {
      const stores = await Store.find({}).lean();
      return rows.map((r) => {
        const store = stores.find((s) => s.code === str(r.store_code).toUpperCase());
        if (!store) return { error: 'store_code not found' };
        if (!canAccessStore(user, store._id)) return { error: `no access to store ${store.code}` };
        const date = new Date(str(r.date || r.date_yyyy_mm_dd));
        if (Number.isNaN(date.getTime())) return { error: 'date is invalid' };
        const category = str(r.category).toLowerCase();
        if (!Expense.CATEGORIES.includes(category)) return { error: 'invalid category' };
        const amount = num(r.amount);
        if (!(amount > 0)) return { error: 'amount must be positive' };
        const pm = str(r.payment_method).toLowerCase() || 'cash';
        if (!['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other'].includes(pm)) return { error: 'invalid payment_method' };
        return { key: `${store.code}|${date.toISOString().slice(0, 10)}|${category}|${amount}|${str(r.reference)}`, data: { store: store._id, date, category, amount, vendor: str(r.vendor) || undefined, paymentMethod: pm, reference: str(r.reference) || undefined, notes: str(r.notes) || undefined } };
      });
    },
    async apply(item, user) {
      await Expense.create({ ...item.data, status: 'pending', createdBy: user._id });
    },
  },
};

const previews = new Map(); // token -> { user, type, items, at }
const TTL = 30 * 60 * 1000;
function sweep() {
  const now = Date.now();
  for (const [k, v] of previews) if (now - v.at > TTL) previews.delete(k);
}

router.get('/types', (req, res) => {
  res.json({
    imports: Object.entries(IMPORTS).filter(([, d]) => hasPermission(req.user, 'import.manage') && hasPermission(req.user, d.perm)).map(([k, d]) => ({ type: k, columns: d.columns, note: d.note })),
    exports: Object.entries(EXPORTS).filter(([, d]) => hasPermission(req.user, 'export.data') && hasPermission(req.user, d.perm)).map(([k]) => k),
  });
});

router.get('/template/:type', requirePermission('import.manage'), ah(async (req, res) => {
  const def = IMPORTS[req.params.type];
  if (!def) throw new ApiError(404, 'Unknown import type');
  const columns = def.columns.map((c) => ({ header: c.split(' ')[0].replace('*', ''), key: c }));
  const note = [
    `Sudama Pharma import template: ${req.params.type}`,
    `Required columns are marked * in this list: ${def.columns.join(', ')}`,
    'Keep the header row exactly as provided. Enter one record per row starting from row 2.',
    'Use only verified data from product packs, invoices and licences. Do not guess compositions, barcodes or regulatory details.',
    def.note || '',
  ].join('\n');
  await sendWorkbook(res, { filename: `sudama-${req.params.type}-template`, sheets: [{ name: req.params.type, columns, rows: [], note }] });
}));

router.post('/preview/:type', requirePermission('import.manage'), sheetUpload.single('file'), ah(async (req, res) => {
  const def = IMPORTS[req.params.type];
  if (!def) throw new ApiError(404, 'Unknown import type');
  if (!hasPermission(req.user, def.perm)) throw new ApiError(403, 'You do not have permission to import this data');
  if (!req.file) throw new ApiError(400, 'Upload an .xlsx or .csv file');
  const rows = await readRows(req.file.buffer, req.file.originalname);
  if (!rows.length) throw new ApiError(400, 'The file has no data rows');
  if (rows.length > 5000) throw new ApiError(400, 'Maximum 5000 rows per import');
  const prepared = await def.prepare(rows, req.user);
  const seen = new Map();
  const errors = [];
  const valid = [];
  prepared.forEach((p, i) => {
    const rowNo = rows[i].__row;
    if (p.error) return errors.push({ row: rowNo, message: p.error });
    if (seen.has(p.key)) return errors.push({ row: rowNo, message: `duplicate of row ${seen.get(p.key)} in this file` });
    seen.set(p.key, rowNo);
    valid.push({ ...p, row: rowNo });
  });
  sweep();
  const token = crypto.randomBytes(16).toString('hex');
  previews.set(token, { user: String(req.user._id), type: req.params.type, items: valid, at: Date.now() });
  res.json({
    token,
    totalRows: rows.length,
    validRows: valid.length,
    newRecords: valid.filter((v) => !v.existing).length,
    updates: valid.filter((v) => v.existing).map((v) => ({ row: v.row, key: v.key })),
    errors,
    sample: valid.slice(0, 20).map((v) => ({ row: v.row, key: v.key, action: v.existing ? 'update' : 'create' })),
  });
}));

router.post('/commit/:type', requirePermission('import.manage'), ah(async (req, res) => {
  const def = IMPORTS[req.params.type];
  const p = previews.get(String(req.body?.token || ''));
  if (!def || !p || p.user !== String(req.user._id) || p.type !== req.params.type) throw new ApiError(400, 'Preview expired. Upload the file again.');
  if (!hasPermission(req.user, def.perm)) throw new ApiError(403, 'You do not have permission to import this data');
  const confirmUpdates = req.body.confirmUpdates === true;
  const summary = { created: 0, updated: 0, skippedExisting: 0, failed: [] };
  for (const item of p.items) {
    if (item.existing && !confirmUpdates) {
      summary.skippedExisting += 1;
      continue;
    }
    try {
      await def.apply(item, req.user);
      if (item.existing) summary.updated += 1;
      else summary.created += 1;
    } catch (e) {
      summary.failed.push({ row: item.row, message: e.message });
    }
  }
  previews.delete(req.body.token);
  await audit(req, `import.${req.params.type}`, 'Import', req.params.type, summary);
  res.json(summary);
}));

// ---------------- EXPORTS ----------------
const d10 = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const EXPORTS = {
  products: {
    perm: 'products.view',
    async rows() {
      const ps = await Product.find({}).populate('category subcategory', 'name').lean();
      return ps.map((p) => ({ sku: p.sku, name: p.name, mrp: p.mrp, barcodes: (p.barcodes || []).join('|'), generic_name: p.genericName, brand: p.brand, manufacturer: p.manufacturer, marketer: p.marketer, composition: p.composition, strength: p.strength, dosage_form: p.dosageForm, pack_size: p.packSize, units_per_strip: p.unitsPerStrip, strips_per_box: p.stripsPerBox, category: p.category?.name, subcategory: p.subcategory?.name, retail_price: p.retailPrice, wholesale_price: p.wholesalePrice, purchase_cost: p.purchaseCost, gst_rate: p.gstRate, hsn_code: p.hsnCode, discount_percent: p.discountPercent, prescription_required: p.prescriptionRequired ? 'yes' : 'no', schedule_class: p.scheduleClass, min_wholesale_qty: p.minWholesaleQty, low_stock_threshold: p.lowStockThreshold, data_verified: p.dataVerified ? 'yes' : 'no', active: p.active ? 'yes' : 'no' }));
    },
  },
  categories: {
    perm: 'products.view',
    async rows() {
      const cs = await Category.find({}).populate('parent', 'name').lean();
      return cs.map((c) => ({ name: c.name, parent_name: c.parent?.name, description: c.description, discount_percent: c.discountPercent, sort_order: c.sortOrder, active: c.active ? 'yes' : 'no' }));
    },
  },
  suppliers: {
    perm: 'suppliers.view',
    async rows() {
      const ss = await Supplier.find({}).lean();
      return ss.map((s) => ({ name: s.name, code: s.code, contact_person: s.contactPerson, phone: s.phone, email: s.email, gstin: s.gstin, drug_license_no: s.drugLicenseNo, address: s.address?.line1, city: s.address?.city, district: s.address?.district, pincode: s.address?.pincode, payment_terms_days: s.paymentTermsDays }));
    },
  },
  inventory: {
    perm: 'inventory.view',
    async rows(req) {
      const bs = await InventoryBatch.find({ ...storeFilter(req), $or: [{ qtyAvailable: { $gt: 0 } }, { qtyReserved: { $gt: 0 } }, { qtyQuarantined: { $gt: 0 } }, { qtyDamaged: { $gt: 0 } }] }).populate('store', 'code').populate('product', 'sku name').populate('supplier', 'name').lean();
      return bs.map((b) => ({ store_code: b.store?.code, sku: b.product?.sku, product: b.product?.name, batch_no: b.batchNo, expiry_date: d10(b.expiryDate), mfg_date: d10(b.mfgDate), mrp: b.mrp, cost_per_unit: b.costPerUnit, available: b.qtyAvailable, reserved: b.qtyReserved, quarantined: b.qtyQuarantined, damaged: b.qtyDamaged, status: b.status, supplier: b.supplier?.name }));
    },
  },
  employees: {
    perm: 'employees.view',
    async rows(req) {
      const sf = storeFilter(req, 'stores');
      const q = User.find({ ...sf, role: { $nin: ['customer', 'wholesale_buyer', 'advertiser'] } }).populate('stores', 'code');
      const withSalary = hasPermission(req.user, 'salary.view');
      if (withSalary) q.select('+employee.salary');
      const us = await q.lean();
      return us.filter((u) => isStaff(u.role) || u.role === 'delivery_partner').map((u) => ({ employee_id: u.employee?.employeeId, name: u.name, phone: u.phone, email: u.email, role: u.role, stores: (u.stores || []).map((s) => s.code).join('|'), joining_date: d10(u.employee?.joiningDate), status: u.employee?.status, active: u.active ? 'yes' : 'no', ...(withSalary ? { monthly_salary: u.employee?.salary } : {}) }));
    },
  },
  orders: {
    perm: 'orders.view',
    async rows(req) {
      const { from, to } = parseRange(req.query);
      const os = await Order.find({ ...storeFilter(req), createdAt: { $gte: from, $lte: to } }).populate('store', 'code').populate('cashier', 'name').lean();
      return os.map((o) => ({ order_number: o.orderNumber, date: o.createdAt.toISOString(), completed_at: o.completedAt ? o.completedAt.toISOString() : '', store: o.store?.code, channel: o.channel, status: o.status, customer: o.customerName, phone: o.customerPhone, items: o.items.length, mrp_total: o.mrpTotal, discount: o.productDiscount, coupon: o.couponCode, coupon_discount: o.couponDiscount, gst: o.taxTotal, delivery_fee: o.deliveryFee, grand_total: o.grandTotal, refunded: o.refundedAmount, payment_method: o.payment?.method, payment_status: o.payment?.status, payment_ref: o.payment?.reference, cashier: o.cashier?.name }));
    },
  },
  sales: {
    perm: 'reports.view',
    async rows(req) {
      const { from, to } = parseRange(req.query);
      const os = await Order.find({ ...storeFilter(req), completedAt: { $gte: from, $lte: to }, status: { $in: ['completed', 'delivered', 'partially_returned', 'returned'] } }).populate('store', 'code').lean();
      return os.flatMap((o) => o.items.map((i) => ({ date: o.completedAt.toISOString().slice(0, 10), order_number: o.orderNumber, store: o.store?.code, channel: o.channel, sku: i.sku, product: i.name, qty: i.qty, returned_qty: i.returnedQty || 0, mrp: i.mrp, unit_price: i.unitPrice, net_amount: i.netAmount, gst_rate: i.gstRate, taxable: i.taxableAmount, gst: i.taxAmount, cost: i.costTotal, gross_profit: Math.round(((i.taxableAmount || 0) - (i.costTotal || 0)) * 100) / 100, batches: (i.allocations || []).map((a) => `${a.batchNo}x${a.qty}`).join('|') })));
    },
  },
  purchases: {
    perm: 'purchases.view',
    async rows(req) {
      const { from, to } = parseRange(req.query);
      const ps = await Purchase.find({ ...storeFilter(req), createdAt: { $gte: from, $lte: to } }).populate('store', 'code').populate('supplier', 'name gstin').lean({ virtuals: true });
      return ps.map((p) => ({ number: p.number, date: d10(p.createdAt), store: p.store?.code, supplier: p.supplier?.name, supplier_gstin: p.supplier?.gstin, status: p.status, invoice_no: p.supplierInvoiceNo, invoice_date: d10(p.supplierInvoiceDate), taxable: p.totals?.taxableAmount, gst: p.totals?.gstAmount, invoice_amount: p.totals?.invoiceAmount, paid: p.amountPaid, returned: p.amountReturned, outstanding: Math.round(((p.totals?.invoiceAmount || 0) - (p.amountPaid || 0) - (p.amountReturned || 0)) * 100) / 100 }));
    },
  },
  expenses: {
    perm: 'expenses.manage',
    async rows(req) {
      const { from, to } = parseRange(req.query);
      const es = await Expense.find({ ...storeFilter(req), date: { $gte: from, $lte: to } }).populate('store', 'code').populate('approvedBy', 'name').lean();
      return es.map((e) => ({ store_code: e.store?.code, date: d10(e.date), category: e.category, amount: e.amount, vendor: e.vendor, payment_method: e.paymentMethod, reference: e.reference, notes: e.notes, status: e.status, approved_by: e.approvedBy?.name }));
    },
  },
};

router.get('/export/:type', requirePermission('export.data'), ah(async (req, res) => {
  const def = EXPORTS[req.params.type];
  if (!def) throw new ApiError(404, 'Unknown export type');
  if (!hasPermission(req.user, def.perm)) throw new ApiError(403, 'You do not have permission to export this data');
  const rows = await def.rows(req);
  const keys = rows.length ? Object.keys(rows.reduce((a, r) => ({ ...a, ...r }), {})) : ['no_data'];
  await audit(req, `export.${req.params.type}`, 'Export', req.params.type, { rows: rows.length, storeId: req.query.storeId || 'all' });
  await sendWorkbook(res, { filename: `sudama-${req.params.type}-${new Date().toISOString().slice(0, 10)}`, format: req.query.format === 'csv' ? 'csv' : 'xlsx', sheets: [{ name: req.params.type, columns: keys.map((k) => ({ header: k, key: k })), rows }] });
}));

module.exports = router;
module.exports.IMPORTS = IMPORTS;
