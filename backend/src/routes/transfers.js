const express = require('express');
const StockTransfer = require('../models/StockTransfer');
const InventoryBatch = require('../models/InventoryBatch');
const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { nextNumber } = require('../utils/sequence');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { accessibleStoreIds, assertStoreAccess, canAccessStore, toId } = require('../middleware/storeScope');
const inventory = require('../services/inventory');

const router = express.Router();
router.use(authenticate, requirePermission('transfers.manage', 'inventory.view'));

router.get('/', ah(async (req, res) => {
  const allowed = accessibleStoreIds(req.user);
  const filter = allowed === null ? {} : { $or: [{ fromStore: { $in: allowed.map(toId) } }, { toStore: { $in: allowed.map(toId) } }] };
  if (req.query.storeId && req.query.storeId !== 'all') {
    assertStoreAccess(req.user, req.query.storeId);
    filter.$or = [{ fromStore: toId(req.query.storeId) }, { toStore: toId(req.query.storeId) }];
  }
  if (req.query.status) filter.status = req.query.status;
  res.json(await StockTransfer.find(filter).populate('fromStore toStore', 'name code').populate('items.product', 'name sku').populate('requestedBy dispatchedBy receivedBy', 'name').sort('-createdAt').limit(200).lean());
}));

// Request: either store's staff may raise it, as long as they have access to one side
router.post('/', requirePermission('transfers.manage'), validate(z.object({
  fromStore: objectId, toStore: objectId,
  items: z.array(z.object({ product: objectId, qty: z.number().int().min(1) })).min(1),
  notes: z.string().max(300).optional(),
})), ah(async (req, res) => {
  const b = req.body;
  if (b.fromStore === b.toStore) throw new ApiError(400, 'Source and destination stores must be different');
  if (!canAccessStore(req.user, b.fromStore) && !canAccessStore(req.user, b.toStore)) throw new ApiError(403, 'No access to these stores');
  const t = await StockTransfer.create({ ...b, number: await nextNumber('transfer', 'SP-TR'), requestedBy: req.user._id });
  await audit(req, 'transfer.requested', 'StockTransfer', t._id, {}, b.fromStore);
  res.status(201).json(t);
}));

// Dispatch: deduct from source (FEFO), record exact batches sent
router.post('/:id/dispatch', requirePermission('transfers.manage'), ah(async (req, res) => {
  const t = await StockTransfer.findOneAndUpdate({ _id: req.params.id, status: 'requested' }, { $set: { status: 'dispatching' } }, { new: false, strict: false });
  if (!t) throw new ApiError(409, 'Transfer is not awaiting dispatch');
  try {
    assertStoreAccess(req.user, t.fromStore);
    const takes = [];
    try {
      for (const it of t.items) {
        const p = await Product.findById(it.product).select('name').lean();
        const alloc = await inventory.takeStock({ store: t.fromStore, product: it.product, qty: it.qty, mode: 'deduct', movementType: 'transfer_out', refType: 'StockTransfer', refId: t._id, user: req.user._id, productName: p?.name });
        takes.push(alloc);
      }
    } catch (e) {
      await inventory.rollbackTakes(takes, 'deduct');
      throw e;
    }
    for (let i = 0; i < t.items.length; i += 1) {
      const batches = await InventoryBatch.find({ _id: { $in: takes[i].map((a) => a.batch) } }).lean();
      const bmap = new Map(batches.map((b) => [String(b._id), b]));
      t.items[i].allocations = takes[i].map((a) => ({ ...a, mfgDate: bmap.get(String(a.batch))?.mfgDate, mrp: bmap.get(String(a.batch))?.mrp }));
    }
    t.status = 'dispatched';
    t.dispatchedBy = req.user._id;
    t.dispatchedAt = new Date();
    await t.save();
    await audit(req, 'transfer.dispatched', 'StockTransfer', t._id, {}, t.fromStore);
    res.json(t);
  } catch (e) {
    await StockTransfer.updateOne({ _id: t._id, status: 'dispatching' }, { $set: { status: 'requested' } }, { strict: false });
    throw e;
  }
}));

// Receive: destination adds the same batches (same expiry, cost carried over)
router.post('/:id/receive', requirePermission('transfers.manage'), validate(z.object({ notes: z.string().max(300).optional() }).optional()), ah(async (req, res) => {
  const t = await StockTransfer.findOneAndUpdate({ _id: req.params.id, status: 'dispatched' }, { $set: { status: 'receiving' } }, { strict: false });
  if (!t) throw new ApiError(409, 'Transfer is not in transit');
  try {
    assertStoreAccess(req.user, t.toStore);
    for (const it of t.items) {
      for (const a of it.allocations) {
        await inventory.addStock({ store: t.toStore, product: it.product, batchNo: a.batchNo, expiryDate: a.expiryDate, mfgDate: a.mfgDate, qty: a.qty, mrp: a.mrp, costPerUnit: a.unitCost, purchaseRate: a.unitCost, source: 'transfer', movementType: 'transfer_in', refType: 'StockTransfer', refId: t._id, user: req.user._id });
      }
      it.receivedQty = it.allocations.reduce((s, a) => s + a.qty, 0);
    }
    t.status = 'received';
    t.receivedBy = req.user._id;
    t.receivedAt = new Date();
    if (req.body?.notes) t.notes = `${t.notes || ''}\nReceived: ${req.body.notes}`;
    await t.save();
    await audit(req, 'transfer.received', 'StockTransfer', t._id, {}, t.toStore);
    res.json(t);
  } catch (e) {
    await StockTransfer.updateOne({ _id: t._id, status: 'receiving' }, { $set: { status: 'dispatched' } }, { strict: false });
    throw e;
  }
}));

router.post('/:id/cancel', requirePermission('transfers.manage'), ah(async (req, res) => {
  const t = await StockTransfer.findById(req.params.id);
  if (!t) throw new ApiError(404, 'Transfer not found');
  if (!canAccessStore(req.user, t.fromStore) && !canAccessStore(req.user, t.toStore)) throw new ApiError(403, 'No access');
  if (t.status !== 'requested') throw new ApiError(400, 'Only requested transfers can be cancelled');
  t.status = 'cancelled';
  await t.save();
  res.json(t);
}));

module.exports = router;
