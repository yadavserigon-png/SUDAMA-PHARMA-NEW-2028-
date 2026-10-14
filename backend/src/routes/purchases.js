// Quotations, purchase orders, supplier invoices, goods receipts (GRN), partial deliveries,
// supplier returns and supplier payments.
const express = require('express');
const Purchase = require('../models/Purchase');
const GoodsReceipt = require('../models/GoodsReceipt');
const SupplierReturn = require('../models/SupplierReturn');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const InventoryBatch = require('../models/InventoryBatch');
const StockMovement = require('../models/StockMovement');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { paginate } = require('../utils/paginate');
const { nextNumber } = require('../utils/sequence');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { storeFilter, assertStoreAccess } = require('../middleware/storeScope');
const { privateDocUpload, checkFiles, fileMeta } = require('../middleware/upload');
const { calcPurchaseLine, calcPurchaseTotals } = require('../services/purchaseCalc');
const inventory = require('../services/inventory');
const { round2 } = require('../services/pricing');

const router = express.Router();
router.use(authenticate);

const itemSchema = z.object({
  product: objectId,
  purchaseUnit: z.enum(['unit', 'strip', 'box']).default('box'),
  orderedQty: z.number().min(0),
  freeQty: z.number().min(0).default(0),
  rate: z.number().min(0),
  discountPercent: z.number().min(0).max(100).default(0),
  gstRate: z.number().min(0).max(28).optional(),
  mrp: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
});

// Live bulk calculator (no save) - boxes/strips/units, free qty, landed cost, margin
router.post('/calculate', requirePermission('purchases.view', 'purchases.manage'), validate(z.object({ items: z.array(itemSchema).min(1), otherCharges: z.number().min(0).default(0) })), ah(async (req, res) => {
  const products = await Product.find({ _id: { $in: req.body.items.map((i) => i.product) } }).lean();
  const pmap = new Map(products.map((p) => [String(p._id), p]));
  const subtotal = req.body.items.reduce((s, i) => s + i.orderedQty * i.rate, 0) || 1;
  const lines = req.body.items.map((i) => ({ ...i, paidQty: i.orderedQty, otherCharges: (req.body.otherCharges * i.orderedQty * i.rate) / subtotal }));
  res.json(calcPurchaseTotals(lines, lines.map((l) => pmap.get(String(l.product)))));
}));

async function prepareItems(items) {
  const products = await Product.find({ _id: { $in: items.map((i) => i.product) } }).lean();
  const pmap = new Map(products.map((p) => [String(p._id), p]));
  return items.map((i) => {
    const p = pmap.get(String(i.product));
    if (!p) throw new ApiError(400, 'Product not found in purchase');
    const calc = calcPurchaseLine({ ...i, paidQty: i.orderedQty, gstRate: i.gstRate ?? p.gstRate }, p);
    return { ...i, productName: p.name, gstRate: i.gstRate ?? p.gstRate, unitsPerPack: calc.unitsPerPack, mrp: i.mrp ?? p.mrp };
  });
}

function computeTotals(purchase) {
  const subtotal = purchase.items.reduce((s, i) => s + i.orderedQty * i.rate, 0) || 1;
  const lines = purchase.items.map((i) => ({ paidQty: i.orderedQty, freeQty: i.freeQty, rate: i.rate, discountPercent: i.discountPercent, gstRate: i.gstRate, unitsPerPack: i.unitsPerPack, otherCharges: ((purchase.otherCharges || 0) * i.orderedQty * i.rate) / subtotal }));
  const t = calcPurchaseTotals(lines);
  return { grossAmount: t.grossAmount, discountAmount: t.discountAmount, taxableAmount: t.taxableAmount, gstAmount: t.gstAmount, invoiceAmount: round2(t.invoiceAmount + (purchase.otherCharges || 0)), landedCost: t.landedCost };
}

router.get('/', requirePermission('purchases.view', 'purchases.manage'), ah(async (req, res) => {
  const { page, limit, skip } = paginate(req);
  const filter = storeFilter(req);
  if (req.query.status) filter.status = req.query.status;
  if (req.query.supplier) filter.supplier = req.query.supplier;
  const [items, total] = await Promise.all([
    Purchase.find(filter).populate('supplier', 'name').populate('store', 'name code').sort('-createdAt').skip(skip).limit(limit),
    Purchase.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

router.get('/:id', requirePermission('purchases.view', 'purchases.manage'), ah(async (req, res) => {
  const p = await Purchase.findById(req.params.id).populate('supplier').populate('store', 'name code').populate('items.product', 'name sku unitsPerStrip stripsPerBox');
  if (!p) throw new ApiError(404, 'Purchase not found');
  assertStoreAccess(req.user, p.store._id);
  const [receipts, returns] = await Promise.all([
    GoodsReceipt.find({ purchase: p._id }).populate('receivedBy', 'name').lean(),
    SupplierReturn.find({ purchase: p._id }).lean(),
  ]);
  const pending = p.items.map((i) => ({ product: i.product, productName: i.productName, pendingPaid: i.orderedQty - i.receivedQty, pendingFree: i.freeQty - i.receivedFreeQty }));
  res.json({ purchase: p, receipts, returns, pending });
}));

const purchaseSchema = z.object({
  storeId: objectId,
  supplier: objectId,
  kind: z.enum(['quotation', 'purchase_order']).default('purchase_order'),
  items: z.array(itemSchema).min(1),
  otherCharges: z.number().min(0).default(0),
  expectedDate: z.coerce.date().optional(),
  supplierInvoiceNo: z.string().max(60).optional(),
  supplierInvoiceDate: z.coerce.date().optional(),
  notes: z.string().max(1000).optional(),
  submit: z.boolean().optional(),
});

router.post('/', requirePermission('purchases.manage'), validate(purchaseSchema), ah(async (req, res) => {
  const b = req.body;
  assertStoreAccess(req.user, b.storeId);
  if (!(await Supplier.exists({ _id: b.supplier, active: true }))) throw new ApiError(400, 'Supplier not found or inactive');
  const p = new Purchase({
    number: await nextNumber(b.kind === 'quotation' ? 'quotation' : 'purchase', b.kind === 'quotation' ? 'SP-QT' : 'SP-PO'),
    store: b.storeId, supplier: b.supplier, kind: b.kind, items: await prepareItems(b.items), otherCharges: b.otherCharges,
    expectedDate: b.expectedDate, supplierInvoiceNo: b.supplierInvoiceNo, supplierInvoiceDate: b.supplierInvoiceDate, notes: b.notes, createdBy: req.user._id,
    status: b.kind === 'quotation' ? 'quotation' : b.submit ? 'ordered' : 'draft',
  });
  p.totals = computeTotals(p);
  await p.save();
  await audit(req, 'purchase.created', 'Purchase', p._id, { number: p.number, total: p.totals.invoiceAmount }, b.storeId);
  res.status(201).json(p);
}));

router.put('/:id', requirePermission('purchases.manage'), validate(purchaseSchema.partial().omit({ storeId: true })), ah(async (req, res) => {
  const p = await Purchase.findById(req.params.id);
  if (!p) throw new ApiError(404, 'Purchase not found');
  assertStoreAccess(req.user, p.store);
  if (!['draft', 'quotation', 'ordered'].includes(p.status)) throw new ApiError(400, 'Items cannot be edited after goods have been received');
  if (req.body.items) p.items = await prepareItems(req.body.items);
  for (const k of ['supplier', 'otherCharges', 'expectedDate', 'supplierInvoiceNo', 'supplierInvoiceDate', 'notes']) if (req.body[k] !== undefined) p[k] = req.body[k];
  if (req.body.submit && ['draft', 'quotation'].includes(p.status)) {
    p.status = 'ordered';
    p.kind = 'purchase_order';
  }
  p.totals = computeTotals(p);
  await p.save();
  await audit(req, 'purchase.updated', 'Purchase', p._id, { status: p.status }, p.store);
  res.json(p);
}));

router.post('/:id/invoice-file', requirePermission('purchases.manage'), privateDocUpload.single('file'), checkFiles, ah(async (req, res) => {
  const p = await Purchase.findById(req.params.id);
  if (!p) throw new ApiError(404, 'Purchase not found');
  assertStoreAccess(req.user, p.store);
  if (!req.file) throw new ApiError(400, 'No file uploaded');
  p.invoiceFile = fileMeta(req.file);
  await p.save();
  res.json(p);
}));

// Goods receipt: partial deliveries supported; each line names a batch + expiry
router.post('/:id/receive', requirePermission('purchases.manage', 'inventory.manage'), validate(z.object({
  supplierInvoiceNo: z.string().max(60).optional(),
  supplierInvoiceDate: z.coerce.date().optional(),
  notes: z.string().max(500).optional(),
  lines: z.array(z.object({
    product: objectId,
    batchNo: z.string().trim().min(1).max(40),
    expiryDate: z.string().min(7),
    mfgDate: z.string().optional(),
    paidQty: z.number().min(0),
    freeQty: z.number().min(0).default(0),
    mrp: z.number().min(0).optional(),
  })).min(1),
})), ah(async (req, res) => {
  const p = await Purchase.findById(req.params.id);
  if (!p) throw new ApiError(404, 'Purchase not found');
  assertStoreAccess(req.user, p.store);
  if (!['ordered', 'partially_received'].includes(p.status)) throw new ApiError(400, 'Only ordered purchases can be received');

  // validate quantities against pending before touching stock
  const pendingPaid = new Map(p.items.map((i) => [String(i.product), i.orderedQty - i.receivedQty]));
  const pendingFree = new Map(p.items.map((i) => [String(i.product), i.freeQty - i.receivedFreeQty]));
  for (const l of req.body.lines) {
    const k = String(l.product);
    if (!pendingPaid.has(k)) throw new ApiError(400, 'A received product is not on this purchase order');
    pendingPaid.set(k, pendingPaid.get(k) - l.paidQty);
    pendingFree.set(k, pendingFree.get(k) - l.freeQty);
    if (pendingPaid.get(k) < -1e-9 || pendingFree.get(k) < -1e-9) throw new ApiError(400, 'Received quantity exceeds the pending quantity');
    if (l.paidQty + l.freeQty <= 0) throw new ApiError(400, 'Each receipt line needs a quantity');
  }

  const grn = new GoodsReceipt({ number: await nextNumber('grn', 'SP-GRN'), purchase: p._id, store: p.store, supplier: p.supplier, receivedBy: req.user._id, notes: req.body.notes, items: [] });
  const subtotal = p.items.reduce((s, i) => s + i.orderedQty * i.rate, 0) || 1;
  for (const l of req.body.lines) {
    const item = p.items.find((i) => String(i.product) === String(l.product));
    const share = ((p.otherCharges || 0) * l.paidQty * item.rate) / subtotal;
    const calc = calcPurchaseLine({ paidQty: l.paidQty, freeQty: l.freeQty, rate: item.rate, discountPercent: item.discountPercent, gstRate: item.gstRate, unitsPerPack: item.unitsPerPack, otherCharges: share });
    const units = Math.round(calc.totalUnits);
    if (!Number.isInteger(calc.totalUnits)) throw new ApiError(400, 'Received quantity must convert to whole units');
    const batch = await inventory.addStock({
      store: p.store, product: l.product, batchNo: l.batchNo, expiryDate: l.expiryDate, mfgDate: l.mfgDate, qty: units, mrp: l.mrp ?? item.mrp,
      purchaseRate: calc.paidUnits ? round2(calc.taxableAmount / calc.paidUnits) : 0, costPerUnit: calc.costPerUnit, supplier: p.supplier, grnRef: grn._id,
      source: 'purchase', movementType: 'purchase_in', refType: 'GoodsReceipt', refId: grn._id, user: req.user._id,
    });
    grn.items.push({ product: l.product, batch: batch._id, batchNo: batch.batchNo, mfgDate: batch.mfgDate, expiryDate: batch.expiryDate, paidQty: l.paidQty, freeQty: l.freeQty, units, rate: item.rate, costPerUnit: calc.costPerUnit, mrp: batch.mrp, gstRate: item.gstRate });
    item.receivedQty += l.paidQty;
    item.receivedFreeQty += l.freeQty;
  }
  await grn.save();
  if (req.body.supplierInvoiceNo) p.supplierInvoiceNo = req.body.supplierInvoiceNo;
  if (req.body.supplierInvoiceDate) p.supplierInvoiceDate = req.body.supplierInvoiceDate;
  const complete = p.items.every((i) => i.receivedQty >= i.orderedQty && i.receivedFreeQty >= i.freeQty);
  p.status = complete ? 'received' : 'partially_received';
  await p.save();
  await audit(req, 'purchase.received', 'GoodsReceipt', grn._id, { purchase: p.number, lines: grn.items.length }, p.store);
  res.status(201).json({ purchase: p, grn });
}));

router.post('/:id/payments', requirePermission('purchases.manage', 'payments.manage'), validate(z.object({
  amount: z.number().positive(), date: z.coerce.date().default(() => new Date()), method: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other']), reference: z.string().max(80).optional(),
})), ah(async (req, res) => {
  const p = await Purchase.findById(req.params.id);
  if (!p) throw new ApiError(404, 'Purchase not found');
  assertStoreAccess(req.user, p.store);
  if (['draft', 'quotation', 'cancelled'].includes(p.status)) throw new ApiError(400, 'Payments can only be recorded against confirmed purchases');
  if (round2(p.amountPaid + req.body.amount) > round2((p.totals.invoiceAmount || 0) - (p.amountReturned || 0)) + 0.01) throw new ApiError(400, 'Payment exceeds the outstanding balance');
  p.payments.push({ ...req.body, by: req.user._id });
  p.amountPaid = round2(p.amountPaid + req.body.amount);
  await p.save();
  await audit(req, 'purchase.payment', 'Purchase', p._id, req.body, p.store);
  res.json(p);
}));

router.post('/:id/cancel', requirePermission('purchases.manage'), ah(async (req, res) => {
  const p = await Purchase.findById(req.params.id);
  if (!p) throw new ApiError(404, 'Purchase not found');
  assertStoreAccess(req.user, p.store);
  if (!['draft', 'quotation', 'ordered'].includes(p.status)) throw new ApiError(400, 'Received purchases cannot be cancelled - use a supplier return');
  p.status = 'cancelled';
  await p.save();
  await audit(req, 'purchase.cancelled', 'Purchase', p._id, {}, p.store);
  res.json(p);
}));

// Supplier return (expired / damaged / recalled / excess) - takes from batch buckets and records value
router.post('/returns', requirePermission('purchases.manage', 'inventory.manage'), validate(z.object({
  storeId: objectId,
  supplier: objectId,
  purchase: objectId.optional(),
  reason: z.enum(['expired', 'near_expiry', 'damaged', 'recall', 'wrong_item', 'excess', 'other']),
  creditNoteNo: z.string().max(60).optional(),
  items: z.array(z.object({ batch: objectId, qty: z.number().int().min(1), from: z.enum(['available', 'damaged', 'quarantined']) })).min(1),
})), ah(async (req, res) => {
  const b = req.body;
  assertStoreAccess(req.user, b.storeId);
  const field = { available: 'qtyAvailable', damaged: 'qtyDamaged', quarantined: 'qtyQuarantined' };
  const done = [];
  try {
    for (const it of b.items) {
      const f = field[it.from];
      const batch = await InventoryBatch.findOneAndUpdate({ _id: it.batch, store: b.storeId, [f]: { $gte: it.qty } }, { $inc: { [f]: -it.qty } }, { new: true });
      if (!batch) throw new ApiError(409, 'Return quantity exceeds what is in that batch bucket');
      done.push({ it, batch, f });
    }
  } catch (e) {
    for (const d of done) await InventoryBatch.updateOne({ _id: d.batch._id }, { $inc: { [d.f]: d.it.qty } });
    throw e;
  }
  const items = done.map(({ it, batch }) => ({ product: batch.product, batch: batch._id, batchNo: batch.batchNo, qty: it.qty, from: it.from, value: round2(it.qty * (batch.costPerUnit || 0)) }));
  const ret = await SupplierReturn.create({ number: await nextNumber('supplier-return', 'SP-SR'), store: b.storeId, supplier: b.supplier, purchase: b.purchase, items, reason: b.reason, creditNoteNo: b.creditNoteNo, totalValue: round2(items.reduce((s, i) => s + i.value, 0)), createdBy: req.user._id });
  await StockMovement.insertMany(done.map(({ it, batch }) => ({ store: b.storeId, product: batch.product, batch: batch._id, batchNo: batch.batchNo, type: 'supplier_return', qty: it.from === 'available' ? -it.qty : 0, note: `${it.qty} units returned from ${it.from}`, refType: 'SupplierReturn', refId: String(ret._id), user: req.user._id })));
  if (b.purchase) await Purchase.updateOne({ _id: b.purchase }, { $inc: { amountReturned: ret.totalValue } });
  await audit(req, 'supplier_return.created', 'SupplierReturn', ret._id, { value: ret.totalValue }, b.storeId);
  res.status(201).json(ret);
}));

router.get('/returns/list', requirePermission('purchases.view', 'purchases.manage'), ah(async (req, res) => {
  res.json(await SupplierReturn.find(storeFilter(req)).populate('supplier', 'name').populate('store', 'code').sort('-createdAt').limit(200).lean());
}));

module.exports = router;
