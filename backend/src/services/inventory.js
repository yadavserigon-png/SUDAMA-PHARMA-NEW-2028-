// Database-backed stock operations.
// Concurrency safety without multi-document transactions (works on a standalone MongoDB too):
// every decrement is a single atomic findOneAndUpdate guarded by `qtyAvailable >= n`, so two
// cashiers can never sell the same unit. If a multi-batch allocation cannot be completed,
// the already-taken quantities are returned (compensating rollback) and a 409 is raised.

const InventoryBatch = require('../models/InventoryBatch');
const StockMovement = require('../models/StockMovement');
const ApiError = require('../utils/ApiError');
const { planFefo, startOfDay } = require('./stockRules');
const { round2 } = require('./pricing');

function sellableFilter(store, product) {
  return { store, product, status: 'active', qtyAvailable: { $gt: 0 }, expiryDate: { $gt: startOfDay(new Date()) } };
}

async function sellableBatches(store, product) {
  return InventoryBatch.find(sellableFilter(store, product)).sort({ expiryDate: 1 }).lean();
}

async function availableQty(store, product) {
  const r = await InventoryBatch.aggregate([
    { $match: sellableFilter(store, product) },
    { $group: { _id: null, qty: { $sum: '$qtyAvailable' } } },
  ]);
  return r[0]?.qty || 0;
}

async function giveBack(allocations, mode) {
  for (const a of allocations) {
    const inc = mode === 'reserve' ? { qtyAvailable: a.qty, qtyReserved: -a.qty } : { qtyAvailable: a.qty };
    await InventoryBatch.updateOne({ _id: a.batch }, { $inc: inc });
  }
}

/**
 * Take `qty` units of a product from a store, FEFO.
 * mode 'reserve' (online orders) moves units to qtyReserved; mode 'deduct' (POS, transfers) removes them.
 * preferredBatch: try this batch first (e.g. the batch scanned at the counter).
 */
async function takeStock({ store, product, qty, mode = 'deduct', movementType, refType, refId, user, preferredBatch, productName }) {
  if (!Number.isInteger(qty) || qty <= 0) throw new ApiError(400, 'Quantity must be a positive whole number');
  const today = startOfDay(new Date());
  const taken = [];
  let remaining = qty;

  const tryBatch = async (b, n) => {
    const inc = mode === 'reserve' ? { qtyAvailable: -n, qtyReserved: n } : { qtyAvailable: -n };
    const updated = await InventoryBatch.findOneAndUpdate(
      { _id: b._id, store, status: 'active', qtyAvailable: { $gte: n }, expiryDate: { $gt: today } },
      { $inc: inc },
      { new: true },
    );
    if (updated) {
      taken.push({ batch: b._id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: n, unitCost: b.costPerUnit || b.purchaseRate || 0 });
      remaining -= n;
    }
  };

  if (preferredBatch) {
    const b = await InventoryBatch.findOne({ _id: preferredBatch, store, product }).lean();
    if (b && b.status === 'active' && b.expiryDate > today && b.qtyAvailable > 0) await tryBatch(b, Math.min(remaining, b.qtyAvailable));
  }

  for (let attempt = 0; remaining > 0 && attempt < 5; attempt += 1) {
    const plan = planFefo(await sellableBatches(store, product), remaining);
    if (!plan.allocations.length) break;
    for (const a of plan.allocations) {
      if (remaining <= 0) break;
      await tryBatch({ _id: a.batchId, batchNo: a.batchNo, expiryDate: a.expiryDate, costPerUnit: a.unitCost }, Math.min(a.qty, remaining));
    }
  }

  if (remaining > 0) {
    await giveBack(taken, mode);
    const have = qty - remaining;
    throw new ApiError(409, `Insufficient stock for ${productName || 'product'}: requested ${qty}, available ${have}`, { product: String(product), requested: qty, available: have });
  }

  await StockMovement.insertMany(taken.map((t) => ({
    store, product, batch: t.batch, batchNo: t.batchNo,
    type: movementType || (mode === 'reserve' ? 'reserve' : 'sale'),
    qty: -t.qty, refType, refId: refId && String(refId), user,
  })));
  return taken;
}

/** Undo a set of takes (used when a later line of the same bill fails). */
async function rollbackTakes(list, mode) {
  for (const allocations of list) await giveBack(allocations, mode);
}

/** Reserved -> back to available (order cancelled / prescription rejected / payment failed). */
async function releaseReserved({ store, product, allocations, refType, refId, user }) {
  for (const a of allocations) {
    if (!a.qty) continue;
    await InventoryBatch.updateOne({ _id: a.batch, qtyReserved: { $gte: a.qty } }, { $inc: { qtyReserved: -a.qty, qtyAvailable: a.qty } });
    await StockMovement.create({ store, product, batch: a.batch, batchNo: a.batchNo, type: 'release', qty: a.qty, refType, refId: refId && String(refId), user });
  }
}

/** Reserved -> sold (order delivered). qtyAvailable is unchanged; reserved units leave the store. */
async function fulfilReserved({ store, product, allocations, refType, refId, user }) {
  for (const a of allocations) {
    if (!a.qty) continue;
    await InventoryBatch.updateOne({ _id: a.batch, qtyReserved: { $gte: a.qty } }, { $inc: { qtyReserved: -a.qty } });
    await StockMovement.create({ store, product, batch: a.batch, batchNo: a.batchNo, type: 'fulfil', qty: 0, note: `${a.qty} reserved units delivered`, refType, refId: refId && String(refId), user });
  }
}

/**
 * Stock in (purchase receipt, opening stock, transfer in, import).
 * Same store+product+batch is merged; expiry must match. Unit cost is weighted-averaged.
 */
async function addStock({ store, product, batchNo, expiryDate, mfgDate, qty, mrp, purchaseRate = 0, costPerUnit, supplier, grnRef, source = 'purchase', movementType = 'purchase_in', user, refType, refId, note }) {
  if (!Number.isInteger(qty) || qty <= 0) throw new ApiError(400, 'Quantity must be a positive whole number');
  if (!batchNo) throw new ApiError(400, 'Batch number is required');
  if (!expiryDate) throw new ApiError(400, 'Expiry date is required');
  const cost = costPerUnit ?? purchaseRate;
  const bn = String(batchNo).trim().toUpperCase();
  let batch = await InventoryBatch.findOne({ store, product, batchNo: bn });
  if (batch) {
    const newExp = new InventoryBatch({ expiryDate }).expiryDate;
    if (batch.expiryDate.getTime() !== newExp.getTime()) {
      throw new ApiError(400, `Batch ${bn} already exists with a different expiry date. Please verify the batch details.`);
    }
    const totalBefore = batch.qtyAvailable + batch.qtyReserved;
    const avgCost = totalBefore + qty > 0 ? round2((totalBefore * batch.costPerUnit + qty * cost) / (totalBefore + qty)) : cost;
    batch = await InventoryBatch.findByIdAndUpdate(batch._id, { $inc: { qtyAvailable: qty, qtyReceived: qty }, $set: { costPerUnit: avgCost, mrp: mrp ?? batch.mrp } }, { new: true });
  } else {
    batch = await InventoryBatch.create({ store, product, batchNo: bn, expiryDate, mfgDate, mrp, purchaseRate, costPerUnit: cost, qtyReceived: qty, qtyAvailable: qty, supplier, grnRef, source });
  }
  await StockMovement.create({ store, product, batch: batch._id, batchNo: bn, type: movementType, qty, refType, refId: refId && String(refId), user, note });
  return batch;
}

/** Customer return -> quarantine (never directly sellable; needs inspection). */
async function quarantineReturn({ store, product, batch, batchNo, qty, refType, refId, user }) {
  await InventoryBatch.updateOne({ _id: batch, store }, { $inc: { qtyQuarantined: qty } });
  await StockMovement.create({ store, product, batch, batchNo, type: 'customer_return', qty: 0, note: `${qty} units to quarantine pending inspection`, refType, refId: refId && String(refId), user });
}

/** Inspection result for quarantined units: restock (sellable) or damaged. */
async function inspectQuarantine({ batchId, store, restockQty = 0, damagedQty = 0, user, note }) {
  const total = restockQty + damagedQty;
  if (total <= 0) throw new ApiError(400, 'Nothing to inspect');
  const b = await InventoryBatch.findOneAndUpdate(
    { _id: batchId, store, qtyQuarantined: { $gte: total } },
    { $inc: { qtyQuarantined: -total, qtyAvailable: restockQty, qtyDamaged: damagedQty } },
    { new: true },
  );
  if (!b) throw new ApiError(409, 'Quarantined quantity is lower than the inspected quantity');
  const moves = [];
  if (restockQty) moves.push({ store: b.store, product: b.product, batch: b._id, batchNo: b.batchNo, type: 'return_restock', qty: restockQty, user, note });
  if (damagedQty) moves.push({ store: b.store, product: b.product, batch: b._id, batchNo: b.batchNo, type: 'return_damaged', qty: 0, user, note: `${damagedQty} units marked damaged. ${note || ''}` });
  await StockMovement.insertMany(moves);
  return b;
}

/** Manual adjustment of available stock with a reason (damage, count correction, ...). */
async function adjustAvailable({ batchId, store, delta, type = 'adjustment', user, note, toDamaged = false }) {
  if (!Number.isInteger(delta) || delta === 0) throw new ApiError(400, 'Adjustment must be a non-zero whole number');
  const filter = { _id: batchId, store };
  if (delta < 0) filter.qtyAvailable = { $gte: -delta };
  const inc = { qtyAvailable: delta };
  if (toDamaged && delta < 0) inc.qtyDamaged = -delta;
  const b = await InventoryBatch.findOneAndUpdate(filter, { $inc: inc }, { new: true });
  if (!b) throw new ApiError(409, 'Cannot reduce below available quantity (reserved stock is protected)');
  await StockMovement.create({ store: b.store, product: b.product, batch: b._id, batchNo: b.batchNo, type, qty: delta, user, note });
  return b;
}

module.exports = {
  sellableFilter,
  sellableBatches,
  availableQty,
  takeStock,
  rollbackTakes,
  releaseReserved,
  fulfilReserved,
  addStock,
  quarantineReturn,
  inspectQuarantine,
  adjustAvailable,
};
