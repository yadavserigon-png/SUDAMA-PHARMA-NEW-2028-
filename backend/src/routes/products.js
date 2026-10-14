const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const InventoryBatch = require('../models/InventoryBatch');
const Store = require('../models/Store');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { paginate, escapeRegex } = require('../utils/paginate');
const { z, validate } = require('../utils/validate');
const { authenticate, optionalAuth, requirePermission } = require('../middleware/auth');
const { hasPermission } = require('../config/roles');
const { publicImageUpload, checkFiles } = require('../middleware/upload');
const { startOfDay } = require('../services/stockRules');
const pricing = require('../services/pricing');

const router = express.Router();

const isBarcodeLike = (q) => /^\d{8,14}$/.test(q);

/** Sellable stock per product (optionally for one store). */
async function stockMap(productIds, storeId) {
  const match = { product: { $in: productIds }, status: 'active', qtyAvailable: { $gt: 0 }, expiryDate: { $gt: startOfDay(new Date()) } };
  if (storeId) match.store = new mongoose.Types.ObjectId(storeId);
  else match.store = { $in: (await Store.find({ active: true }).select('_id').lean()).map((s) => s._id) };
  const rows = await InventoryBatch.aggregate([{ $match: match }, { $group: { _id: '$product', qty: { $sum: '$qtyAvailable' } } }]);
  return new Map(rows.map((r) => [String(r._id), r.qty]));
}

function stockStatus(qty, threshold = 10) {
  if (!qty) return 'out_of_stock';
  if (qty <= threshold) return 'low_stock';
  return 'in_stock';
}

function publicView(p, catDiscount = 0) {
  const price = pricing.unitPrice(p, { categoryDiscountPercent: catDiscount });
  return {
    _id: p._id, sku: p.sku, name: p.name, genericName: p.genericName, brand: p.brand, manufacturer: p.manufacturer, marketer: p.marketer,
    composition: p.composition, strength: p.strength, dosageForm: p.dosageForm, packSize: p.packSize, category: p.category, subcategory: p.subcategory,
    productType: p.productType, images: p.images, mrp: p.mrp, price: price.unitPrice, discountPercent: price.discountPercent, gstRate: p.gstRate,
    prescriptionRequired: p.prescriptionRequired, scheduleClass: p.scheduleClass, onlineSaleAllowed: p.onlineSaleAllowed, coldChain: p.coldChain,
    description: p.description, usage: p.usage, sideEffects: p.sideEffects, safetyAdvice: p.safetyAdvice, storage: p.storage, featured: p.featured,
    quantityDiscounts: p.quantityDiscounts, active: p.active,
  };
}

// ---------- Search / listing (public; staff see more) ----------
router.get('/', optionalAuth, ah(async (req, res) => {
  const { page, limit, skip } = paginate(req, { defaultLimit: 24, maxLimit: 100 });
  const staff = req.user && hasPermission(req.user, 'products.view');
  const filter = {};
  if (!(staff && req.query.includeInactive === 'true')) filter.active = true;
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q) {
    if (isBarcodeLike(q)) filter.$or = [{ barcodes: q }, { sku: q.toUpperCase() }];
    else {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: rx }, { brand: rx }, { genericName: rx }, { composition: rx }, { manufacturer: rx }, { sku: rx }, { barcodes: q }];
    }
  }
  if (req.query.category && mongoose.isValidObjectId(req.query.category)) {
    const subs = await Category.find({ parent: req.query.category }).select('_id').lean();
    filter.$and = [{ $or: [{ category: { $in: [req.query.category, ...subs.map((s) => s._id)] } }, { subcategory: req.query.category }] }];
  }
  for (const f of ['brand', 'manufacturer', 'dosageForm', 'productType']) if (req.query[f]) filter[f] = req.query[f];
  if (req.query.rx === 'true') filter.prescriptionRequired = true;
  if (req.query.rx === 'false') filter.prescriptionRequired = false;
  if (req.query.featured === 'true') filter.featured = true;
  if (req.query.ids) filter._id = { $in: String(req.query.ids).split(',').filter(mongoose.isValidObjectId) };

  const sorts = { name: { name: 1 }, price_asc: { retailPrice: 1 }, price_desc: { retailPrice: -1 }, newest: { createdAt: -1 } };
  const sort = sorts[req.query.sort] || (q ? { name: 1 } : { featured: -1, name: 1 });
  const [items, total] = await Promise.all([Product.find(filter).sort(sort).skip(skip).limit(limit).lean(), Product.countDocuments(filter)]);

  const storeId = req.query.storeId && mongoose.isValidObjectId(req.query.storeId) ? req.query.storeId : null;
  const stock = await stockMap(items.map((p) => p._id), storeId);
  const cats = await Category.find({ _id: { $in: items.map((p) => p.category).filter(Boolean) } }).lean();
  const catMap = new Map(cats.map((c) => [String(c._id), c]));
  res.json({
    items: items.map((p) => {
      const cat = catMap.get(String(p.category));
      const v = staff ? { ...p, ...publicView(p, cat?.discountPercent) } : publicView(p, cat?.discountPercent);
      v.categoryName = cat?.name;
      v.stockStatus = stockStatus(stock.get(String(p._id)) || 0, p.lowStockThreshold);
      if (staff) v.stockQty = stock.get(String(p._id)) || 0;
      return v;
    }),
    total, page, limit, pages: Math.ceil(total / limit) || 1,
  });
}));

router.get('/facets', ah(async (req, res) => {
  const [brands, manufacturers] = await Promise.all([
    Product.distinct('brand', { active: true }),
    Product.distinct('manufacturer', { active: true }),
  ]);
  res.json({ brands: brands.filter(Boolean).sort(), manufacturers: manufacturers.filter(Boolean).sort() });
}));

// Staff barcode lookup (also used by POS)
router.get('/barcode/:code', authenticate, requirePermission('products.view', 'pos.use'), ah(async (req, res) => {
  const code = String(req.params.code).trim();
  const p = await Product.findOne({ $or: [{ barcodes: code }, { sku: code.toUpperCase() }] }).lean();
  if (!p) throw new ApiError(404, `Unknown barcode "${code}". Verify the product and register this barcode before selling.`);
  res.json(p);
}));

router.get('/:id', optionalAuth, ah(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Product not found');
  const p = await Product.findById(req.params.id).populate('category', 'name slug discountPercent').populate('subcategory', 'name slug').lean();
  const staff = req.user && hasPermission(req.user, 'products.view');
  if (!p || (!p.active && !staff)) throw new ApiError(404, 'Product not found');
  const stores = await Store.find({ active: true }).select('name code address.city').lean();
  const rows = await InventoryBatch.aggregate([
    { $match: { product: p._id, status: 'active', qtyAvailable: { $gt: 0 }, expiryDate: { $gt: startOfDay(new Date()) } } },
    { $group: { _id: '$store', qty: { $sum: '$qtyAvailable' }, nearestExpiry: { $min: '$expiryDate' } } },
  ]);
  const byStore = new Map(rows.map((r) => [String(r._id), r]));
  const availability = stores.map((s) => {
    const r = byStore.get(String(s._id));
    return { store: s, status: stockStatus(r?.qty || 0, p.lowStockThreshold), ...(staff ? { qty: r?.qty || 0 } : {}) };
  });
  const substitutes = p.substitutes?.length
    ? (await Product.find({ _id: { $in: p.substitutes }, active: true }).lean()).map((s) => publicView(s))
    : [];
  const view = staff ? { ...p, ...publicView(p, p.category?.discountPercent) } : publicView(p, p.category?.discountPercent);
  view.category = p.category;
  view.subcategory = p.subcategory;
  res.json({ ...view, availability, substitutes, substituteNote: 'Alternatives are shown for information only. A pharmacist must confirm any substitution - we never substitute automatically.' });
}));

// ---------- Admin ----------
const productSchema = z.object({
  sku: z.string().trim().min(2).max(40),
  barcodes: z.array(z.string().trim().min(4).max(40)).optional(),
  name: z.string().trim().min(2).max(200),
  genericName: z.string().max(200).optional(),
  brand: z.string().max(120).optional(),
  manufacturer: z.string().max(160).optional(),
  marketer: z.string().max(160).optional(),
  composition: z.string().max(500).optional(),
  strength: z.string().max(80).optional(),
  dosageForm: z.string().optional(),
  packSize: z.string().max(80).optional(),
  unitsPerStrip: z.number().int().min(1).optional(),
  stripsPerBox: z.number().int().min(1).optional(),
  unitsPerBox: z.number().int().min(1).optional(),
  category: z.string().optional().nullable(),
  subcategory: z.string().optional().nullable(),
  productType: z.string().optional(),
  description: z.string().max(5000).optional(),
  usage: z.string().max(3000).optional(),
  sideEffects: z.string().max(3000).optional(),
  safetyAdvice: z.string().max(3000).optional(),
  storage: z.string().max(300).optional(),
  images: z.array(z.string()).max(8).optional(),
  mrp: z.number().min(0),
  purchaseCost: z.number().min(0).optional(),
  wholesalePrice: z.number().min(0).optional(),
  retailPrice: z.number().min(0).optional(),
  tierPrices: z.array(z.object({ tier: z.string(), price: z.number().min(0) })).optional(),
  minWholesaleQty: z.number().int().min(1).optional(),
  gstRate: z.number().optional(),
  hsnCode: z.string().max(12).optional(),
  discountPercent: z.number().min(0).max(90).optional(),
  quantityDiscounts: z.array(z.object({ minQty: z.number().int().min(2), percent: z.number().min(0).max(90) })).optional(),
  prescriptionRequired: z.boolean().optional(),
  scheduleClass: z.string().optional(),
  onlineSaleAllowed: z.boolean().optional(),
  coldChain: z.boolean().optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  suppliers: z.array(z.string()).optional(),
  substitutes: z.array(z.string()).optional(),
  dataVerified: z.boolean().optional(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
});

const PRICE_FIELDS = ['mrp', 'retailPrice', 'wholesalePrice', 'discountPercent', 'quantityDiscounts', 'tierPrices', 'purchaseCost'];

async function assertBarcodesFree(codes = [], exceptId) {
  if (!codes.length) return;
  const clash = await Product.findOne({ barcodes: { $in: codes }, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select('name').lean();
  if (clash) throw new ApiError(409, `Barcode already mapped to "${clash.name}"`);
}

router.post('/', authenticate, requirePermission('products.manage'), validate(productSchema), ah(async (req, res) => {
  await assertBarcodesFree(req.body.barcodes);
  const p = await Product.create(req.body);
  await audit(req, 'product.created', 'Product', p._id, { sku: p.sku });
  res.status(201).json(p);
}));

router.put('/:id', authenticate, requirePermission('products.manage'), validate(productSchema.partial()), ah(async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) throw new ApiError(404, 'Product not found');
  if (req.body.barcodes) await assertBarcodesFree(req.body.barcodes, p._id);
  const priceChanges = {};
  for (const f of PRICE_FIELDS) if (req.body[f] !== undefined && JSON.stringify(req.body[f]) !== JSON.stringify(p[f])) priceChanges[f] = { from: p[f], to: req.body[f] };
  Object.assign(p, req.body);
  await p.save();
  await audit(req, Object.keys(priceChanges).length ? 'product.price_changed' : 'product.updated', 'Product', p._id, { fields: Object.keys(req.body), priceChanges });
  res.json(p);
}));

router.post('/:id/barcodes', authenticate, requirePermission('barcodes.register', 'products.manage'), validate(z.object({ code: z.string().trim().min(4).max(40), verified: z.literal(true) })), ah(async (req, res) => {
  // `verified: true` = staff confirmed the physical pack matches this product
  const p = await Product.findById(req.params.id);
  if (!p) throw new ApiError(404, 'Product not found');
  await assertBarcodesFree([req.body.code], p._id);
  if (!p.barcodes.includes(req.body.code)) p.barcodes.push(req.body.code);
  await p.save();
  await audit(req, 'product.barcode_registered', 'Product', p._id, { code: req.body.code });
  res.json(p);
}));

router.delete('/:id/barcodes/:code', authenticate, requirePermission('products.manage'), ah(async (req, res) => {
  const p = await Product.findByIdAndUpdate(req.params.id, { $pull: { barcodes: req.params.code } }, { new: true });
  if (!p) throw new ApiError(404, 'Product not found');
  await audit(req, 'product.barcode_removed', 'Product', p._id, { code: req.params.code });
  res.json(p);
}));

router.post('/:id/images', authenticate, requirePermission('products.manage'), publicImageUpload.array('images', 6), checkFiles, ah(async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) throw new ApiError(404, 'Product not found');
  p.images.push(...(req.files || []).map((f) => `/uploads/public/${f.filename}`));
  p.images = p.images.slice(0, 8);
  await p.save();
  res.json(p);
}));

module.exports = router;
