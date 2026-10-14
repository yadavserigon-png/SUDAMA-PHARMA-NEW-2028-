const express = require('express');
const mongoose = require('mongoose');
const InventoryBatch = require('../models/InventoryBatch');
const StockMovement = require('../models/StockMovement');
const StockCount = require('../models/StockCount');
const Product = require('../models/Product');
const Order = require('../models/Order');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { paginate, escapeRegex } = require('../utils/paginate');
const { nextNumber } = require('../utils/sequence');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { storeFilter, assertStoreAccess, toId } = require('../middleware/storeScope');
const inventory = require('../services/inventory');
const { startOfDay, expiryBucket, DAY } = require('../services/stockRules');
const { getSetting } = require('../services/settings');

const router = express.Router();
router.use(authenticate);

async function productFilter(q) {
  if (!q) return {};
  const rx = new RegExp(escapeRegex(q), 'i');
  const ids = await Product.find({ $or: [{ name: rx }, { sku: rx }, { brand: rx }, { barcodes: q }] }).select('_id').limit(500).lean();
  return { product: { $in: ids.map((p) => p._id) } };
}

// ---------- Batch list ----------
router.get('/batches', requirePermission('inventory.view'), ah(async (req, res) => {
  const { page, limit, skip } = paginate(req, { defaultLimit: 50 });
  const filter = { ...storeFilter(req), ...(await productFilter(req.query.q)) };
  if (req.query.product && mongoose.isValidObjectId(req.query.product)) filter.product = toId(req.query.product);
  if (req.query.status) filter.status = req.query.status;
  if (req.query.withStock === 'true') filter.$or = [{ qtyAvailable: { $gt: 0 } }, { qtyReserved: { $gt: 0 } }, { qtyQuarantined: { $gt: 0 } }];
  const [items, total] = await Promise.all([
    InventoryBatch.find(filter).populate('product', 'name sku brand packSize').populate('store', 'name code').populate('supplier', 'name').sort({ expiryDate: 1 }).skip(skip).limit(limit).lean(),
    InventoryBatch.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

// ---------- Stock summary per product ----------
router.get('/stock', requirePermission('inventory.view'), ah(async (req, res) => {
  const today = startOfDay(new Date());
  const match = { ...storeFilter(req), ...(await productFilter(req.query.q)) };
  const rows = await InventoryBatch.aggregate([
    { $match: match },
    { $addFields: { sellable: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$expiryDate', today] }] }, '$qtyAvailable', 0] } } },
    { $group: {
      _id: { store: '$store', product: '$product' },
      sellable: { $sum: '$sellable' },
      available: { $sum: '$qtyAvailable' },
      reserved: { $sum: '$qtyReserved' },
      quarantined: { $sum: '$qtyQuarantined' },
      damaged: { $sum: '$qtyDamaged' },
      costValue: { $sum: { $multiply: ['$sellable', '$costPerUnit'] } },
      mrpValue: { $sum: { $multiply: ['$sellable', '$mrp'] } },
      nearestExpiry: { $min: { $cond: [{ $gt: ['$sellable', 0] }, '$expiryDate', null] } },
      batches: { $sum: 1 },
    } },
    { $lookup: { from: 'products', localField: '_id.product', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    { $lookup: { from: 'stores', localField: '_id.store', foreignField: '_id', as: 'store' } },
    { $unwind: '$store' },
    { $project: { sellable: 1, available: 1, reserved: 1, quarantined: 1, damaged: 1, costValue: 1, mrpValue: 1, nearestExpiry: 1, batches: 1,
      'product._id': 1, 'product.name': 1, 'product.sku': 1, 'product.lowStockThreshold': 1, 'product.packSize': 1, 'store._id': 1, 'store.name': 1, 'store.code': 1 } },
    { $sort: { 'product.name': 1 } },
  ]);
  let items = rows.map((r) => ({ ...r, status: r.sellable === 0 ? 'out_of_stock' : r.sellable <= (r.product.lowStockThreshold ?? 10) ? 'low_stock' : 'in_stock' }));
  if (req.query.status) items = items.filter((i) => i.status === req.query.status);
  res.json({ items, total: items.length });
}));

// ---------- Stock in (opening stock / manual receipt) ----------
const stockInSchema = z.object({
  storeId: objectId,
  productId: objectId,
  batchNo: z.string().trim().min(1).max(40),
  expiryDate: z.string().min(7),
  mfgDate: z.string().optional(),
  qty: z.number().int().min(1),
  mrp: z.number().min(0),
  purchaseRate: z.number().min(0).optional(),
  supplier: objectId.optional(),
  source: z.enum(['opening', 'adjustment', 'purchase']).default('opening'),
  note: z.string().max(300).optional(),
});

router.post('/stock-in', requirePermission('inventory.manage'), validate(stockInSchema), ah(async (req, res) => {
  const b = req.body;
  assertStoreAccess(req.user, b.storeId);
  const product = await Product.findById(b.productId);
  if (!product) throw new ApiError(404, 'Product not found');
  if (b.mrp > 0 && product.mrp && b.mrp < product.retailPrice) throw new ApiError(400, `Batch MRP ₹${b.mrp} is lower than the product selling price ₹${product.retailPrice}. Update the product price first.`);
  const batch = await inventory.addStock({
    store: b.storeId, product: b.productId, batchNo: b.batchNo, expiryDate: b.expiryDate, mfgDate: b.mfgDate, qty: b.qty, mrp: b.mrp,
    purchaseRate: b.purchaseRate || 0, supplier: b.supplier, source: b.source, movementType: b.source === 'purchase' ? 'purchase_in' : 'opening', user: req.user._id, note: b.note,
  });
  await audit(req, 'inventory.stock_in', 'InventoryBatch', batch._id, { qty: b.qty, batchNo: b.batchNo }, b.storeId);
  res.status(201).json(batch);
}));

async function loadBatch(req) {
  const batch = await InventoryBatch.findById(req.params.id);
  if (!batch) throw new ApiError(404, 'Batch not found');
  assertStoreAccess(req.user, batch.store);
  return batch;
}

router.post('/batches/:id/adjust', requirePermission('inventory.manage'), validate(z.object({
  delta: z.number().int().refine((v) => v !== 0, 'Adjustment cannot be zero'),
  type: z.enum(['adjustment', 'damage']).default('adjustment'),
  reason: z.string().trim().min(3).max(300),
})), ah(async (req, res) => {
  const batch = await loadBatch(req);
  if (req.body.type === 'damage' && req.body.delta > 0) throw new ApiError(400, 'Damage must reduce stock');
  const b = await inventory.adjustAvailable({ batchId: batch._id, store: batch.store, delta: req.body.delta, type: req.body.type, user: req.user._id, note: req.body.reason, toDamaged: req.body.type === 'damage' });
  await audit(req, `inventory.${req.body.type}`, 'InventoryBatch', batch._id, req.body, batch.store);
  res.json(b);
}));

router.post('/batches/:id/status', requirePermission('inventory.manage'), validate(z.object({
  status: z.enum(['active', 'quarantined', 'recalled', 'blocked']),
  reason: z.string().trim().min(3).max(300),
})), ah(async (req, res) => {
  const batch = await loadBatch(req);
  if (req.body.status === 'active' && startOfDay(batch.expiryDate) <= startOfDay(new Date())) throw new ApiError(400, 'An expired batch cannot be re-activated');
  batch.status = req.body.status;
  await batch.save();
  await StockMovement.create({ store: batch.store, product: batch.product, batch: batch._id, batchNo: batch.batchNo, type: req.body.status === 'recalled' ? 'recall' : 'quarantine', qty: 0, user: req.user._id, note: `Status -> ${req.body.status}: ${req.body.reason}` });
  await audit(req, 'inventory.batch_status', 'InventoryBatch', batch._id, req.body, batch.store);
  res.json(batch);
}));

// Inspect returned (quarantined) units: restock to sellable or mark damaged
router.post('/batches/:id/inspect', requirePermission('inventory.manage'), validate(z.object({
  restockQty: z.number().int().min(0).default(0),
  damagedQty: z.number().int().min(0).default(0),
  note: z.string().trim().min(3).max(300),
})), ah(async (req, res) => {
  const batch = await loadBatch(req);
  if (req.body.restockQty > 0 && (batch.status !== 'active' || startOfDay(batch.expiryDate) <= startOfDay(new Date()))) {
    throw new ApiError(400, 'Units of an expired/blocked batch cannot be restocked - mark them damaged');
  }
  const b = await inventory.inspectQuarantine({ batchId: batch._id, store: batch.store, ...req.body, user: req.user._id });
  await audit(req, 'inventory.return_inspected', 'InventoryBatch', batch._id, req.body, batch.store);
  res.json(b);
}));

// ---------- Alerts ----------
router.get('/alerts/expiry', requirePermission('inventory.view'), ah(async (req, res) => {
  const cfg = await getSetting('inventory');
  const days = Math.min(730, parseInt(req.query.days, 10) || cfg.defaultExpiryAlertDays || 90);
  const now = new Date();
  const limitDate = new Date(startOfDay(now).getTime() + days * DAY);
  const batches = await InventoryBatch.find({
    ...storeFilter(req),
    expiryDate: { $lte: limitDate },
    $or: [{ qtyAvailable: { $gt: 0 } }, { qtyReserved: { $gt: 0 } }, { qtyQuarantined: { $gt: 0 } }],
  }).populate('product', 'name sku brand').populate('store', 'name code').populate('supplier', 'name phone').sort({ expiryDate: 1 }).lean();
  const thresholds = cfg.expiryAlertDays || [180, 90, 60, 30, 7];
  const items = batches.map((b) => ({ ...b, ...expiryBucket(b.expiryDate, now, thresholds), valueAtCost: Math.round(b.qtyAvailable * (b.costPerUnit || 0) * 100) / 100 }));
  const summary = items.reduce((s, i) => ({ ...s, [i.bucket || 'other']: (s[i.bucket || 'other'] || 0) + 1 }), {});
  res.json({ days, thresholds, summary, items });
}));

router.get('/alerts/low-stock', requirePermission('inventory.view'), ah(async (req, res) => {
  req.query.status = undefined;
  const today = startOfDay(new Date());
  const rows = await InventoryBatch.aggregate([
    { $match: storeFilter(req) },
    { $group: { _id: { store: '$store', product: '$product' }, sellable: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$expiryDate', today] }] }, '$qtyAvailable', 0] } } } },
    { $lookup: { from: 'products', localField: '_id.product', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    { $match: { 'product.active': true, $expr: { $lte: ['$sellable', { $ifNull: ['$product.lowStockThreshold', 10] }] } } },
    { $lookup: { from: 'stores', localField: '_id.store', foreignField: '_id', as: 'store' } },
    { $unwind: '$store' },
    { $project: { sellable: 1, 'product._id': 1, 'product.name': 1, 'product.sku': 1, 'product.lowStockThreshold': 1, 'store._id': 1, 'store.name': 1, 'store.code': 1 } },
    { $sort: { sellable: 1 } },
  ]);
  res.json({
    outOfStock: rows.filter((r) => r.sellable === 0),
    lowStock: rows.filter((r) => r.sellable > 0),
  });
}));

// ---------- Ledger (batch traceability) ----------
router.get('/movements', requirePermission('inventory.view'), ah(async (req, res) => {
  const { page, limit, skip } = paginate(req, { defaultLimit: 50 });
  const filter = storeFilter(req);
  if (req.query.product && mongoose.isValidObjectId(req.query.product)) filter.product = toId(req.query.product);
  if (req.query.batch && mongoose.isValidObjectId(req.query.batch)) filter.batch = toId(req.query.batch);
  if (req.query.batchNo) filter.batchNo = String(req.query.batchNo).toUpperCase();
  if (req.query.type) filter.type = req.query.type;
  const [items, total] = await Promise.all([
    StockMovement.find(filter).populate('product', 'name sku').populate('store', 'code').populate('user', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    StockMovement.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

// ---------- Valuation ----------
router.get('/valuation', requirePermission('inventory.view', 'reports.view'), ah(async (req, res) => {
  const today = startOfDay(new Date());
  const rows = await InventoryBatch.aggregate([
    { $match: storeFilter(req) },
    { $addFields: { sellable: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$expiryDate', today] }] }, { $add: ['$qtyAvailable', '$qtyReserved'] }, 0] } } },
    { $group: {
      _id: '$store',
      units: { $sum: '$sellable' },
      costValue: { $sum: { $multiply: ['$sellable', '$costPerUnit'] } },
      mrpValue: { $sum: { $multiply: ['$sellable', '$mrp'] } },
      expiredUnits: { $sum: { $cond: [{ $lte: ['$expiryDate', today] }, { $add: ['$qtyAvailable', '$qtyQuarantined'] }, 0] } },
      expiredCost: { $sum: { $cond: [{ $lte: ['$expiryDate', today] }, { $multiply: [{ $add: ['$qtyAvailable', '$qtyQuarantined'] }, '$costPerUnit'] }, 0] } },
      damagedUnits: { $sum: '$qtyDamaged' },
    } },
    { $lookup: { from: 'stores', localField: '_id', foreignField: '_id', as: 'store' } },
    { $unwind: '$store' },
    { $project: { units: 1, costValue: { $round: ['$costValue', 2] }, mrpValue: { $round: ['$mrpValue', 2] }, expiredUnits: 1, expiredCost: { $round: ['$expiredCost', 2] }, damagedUnits: 1, 'store.name': 1, 'store.code': 1 } },
    { $sort: { 'store.code': 1 } },
  ]);
  const total = rows.reduce((t, r) => ({ units: t.units + r.units, costValue: t.costValue + r.costValue, mrpValue: t.mrpValue + r.mrpValue }), { units: 0, costValue: 0, mrpValue: 0 });
  res.json({ stores: rows, total });
}));

// ---------- Fast / slow / dead stock ----------
router.get('/analysis', requirePermission('inventory.view', 'reports.view'), ah(async (req, res) => {
  const cfg = await getSetting('inventory');
  const days = Math.min(365, parseInt(req.query.days, 10) || 30);
  const deadDays = cfg.deadStockDays || 90;
  const sf = storeFilter(req);
  const since = new Date(Date.now() - days * DAY);
  const deadSince = new Date(Date.now() - deadDays * DAY);
  const sales = await Order.aggregate([
    { $match: { ...sf, completedAt: { $gte: deadSince < since ? deadSince : since } } },
    { $unwind: '$items' },
    { $group: {
      _id: '$items.product',
      qtyWindow: { $sum: { $cond: [{ $gte: ['$completedAt', since] }, { $subtract: ['$items.qty', '$items.returnedQty'] }, 0] } },
      qtyDead: { $sum: { $subtract: ['$items.qty', '$items.returnedQty'] } },
      lastSold: { $max: '$completedAt' },
    } },
  ]);
  const salesMap = new Map(sales.map((s) => [String(s._id), s]));
  const today = startOfDay(new Date());
  const stock = await InventoryBatch.aggregate([
    { $match: { ...sf, status: 'active', expiryDate: { $gt: today } } },
    { $group: { _id: '$product', qty: { $sum: '$qtyAvailable' }, value: { $sum: { $multiply: ['$qtyAvailable', '$costPerUnit'] } } } },
    { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'p' } },
    { $unwind: '$p' },
    { $project: { qty: 1, value: 1, name: '$p.name', sku: '$p.sku' } },
  ]);
  const items = stock.map((s) => {
    const sale = salesMap.get(String(s._id));
    const sold = sale?.qtyWindow || 0;
    const perDay = sold / days;
    return { product: s._id, name: s.name, sku: s.sku, stockQty: s.qty, stockValue: Math.round(s.value * 100) / 100, soldInWindow: sold, lastSold: sale?.lastSold || null, daysOfCover: perDay > 0 ? Math.round(s.qty / perDay) : null };
  });
  const moving = items.filter((i) => i.soldInWindow > 0).sort((a, b) => b.soldInWindow - a.soldInWindow);
  const cut = Math.max(1, Math.ceil(moving.length * 0.2));
  res.json({
    days, deadDays,
    fastMoving: moving.slice(0, cut),
    slowMoving: moving.slice(cut).filter((i) => i.daysOfCover === null || i.daysOfCover > 60),
    deadStock: items.filter((i) => i.stockQty > 0 && !(salesMap.get(String(i.product))?.qtyDead > 0)),
  });
}));

// ---------- Physical stock count / reconciliation ----------
router.get('/counts', requirePermission('inventory.view'), ah(async (req, res) => {
  res.json(await StockCount.find(storeFilter(req)).populate('store', 'name code').populate('createdBy approvedBy', 'name').sort('-createdAt').limit(100).lean());
}));

router.post('/counts', requirePermission('inventory.manage'), validate(z.object({ storeId: objectId, productIds: z.array(objectId).optional(), notes: z.string().max(300).optional() })), ah(async (req, res) => {
  assertStoreAccess(req.user, req.body.storeId);
  const filter = { store: req.body.storeId, $or: [{ qtyAvailable: { $gt: 0 } }, { qtyReserved: { $gt: 0 } }] };
  if (req.body.productIds?.length) filter.product = { $in: req.body.productIds };
  const batches = await InventoryBatch.find(filter).lean();
  const count = await StockCount.create({
    number: await nextNumber('stockcount', 'SP-SC'),
    store: req.body.storeId,
    lines: batches.map((b) => ({ batch: b._id, product: b.product, batchNo: b.batchNo, systemQty: b.qtyAvailable + b.qtyReserved })),
    createdBy: req.user._id,
    notes: req.body.notes,
  });
  res.status(201).json(count);
}));

router.get('/counts/:id', requirePermission('inventory.view'), ah(async (req, res) => {
  const c = await StockCount.findById(req.params.id).populate('lines.product', 'name sku').populate('store', 'name code').lean();
  if (!c) throw new ApiError(404, 'Count not found');
  assertStoreAccess(req.user, c.store._id);
  res.json(c);
}));

router.put('/counts/:id', requirePermission('inventory.manage'), validate(z.object({ lines: z.array(z.object({ lineId: objectId, countedQty: z.number().int().min(0), note: z.string().max(200).optional() })), submit: z.boolean().optional() })), ah(async (req, res) => {
  const c = await StockCount.findById(req.params.id);
  if (!c) throw new ApiError(404, 'Count not found');
  assertStoreAccess(req.user, c.store);
  if (c.status !== 'open') throw new ApiError(400, 'Count is no longer open');
  for (const l of req.body.lines) {
    const line = c.lines.id(l.lineId);
    if (line) {
      line.countedQty = l.countedQty;
      line.variance = l.countedQty - line.systemQty;
      line.note = l.note;
    }
  }
  if (req.body.submit) c.status = 'submitted';
  await c.save();
  res.json(c);
}));

// Approval applies variances to available stock (reserved stock is never reduced by a count)
router.post('/counts/:id/approve', requirePermission('inventory.manage'), ah(async (req, res) => {
  const c = await StockCount.findById(req.params.id);
  if (!c) throw new ApiError(404, 'Count not found');
  assertStoreAccess(req.user, c.store);
  if (c.status !== 'submitted') throw new ApiError(400, 'Submit the count before approval');
  if (String(c.createdBy) === String(req.user._id) && req.user.role !== 'super_admin') throw new ApiError(403, 'A different authorised person must approve this count');
  const applied = [];
  for (const line of c.lines) {
    if (line.countedQty == null || !line.variance) continue;
    try {
      await inventory.adjustAvailable({ batchId: line.batch, store: c.store, delta: line.variance, type: 'count_correction', user: req.user._id, note: `Stock count ${c.number}` });
      applied.push({ batchNo: line.batchNo, variance: line.variance });
    } catch (e) {
      applied.push({ batchNo: line.batchNo, variance: line.variance, error: e.message });
    }
  }
  c.status = 'approved';
  c.approvedBy = req.user._id;
  c.approvedAt = new Date();
  await c.save();
  await audit(req, 'inventory.count_approved', 'StockCount', c._id, { applied }, c.store);
  res.json({ count: c, applied });
}));

module.exports = router;
