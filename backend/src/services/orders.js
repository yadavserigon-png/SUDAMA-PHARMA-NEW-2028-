// Order building shared by online checkout, POS billing and wholesale orders.
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const Order = require('../models/Order');
const ApiError = require('../utils/ApiError');
const { nextNumber } = require('../utils/sequence');
const pricing = require('./pricing');
const inventory = require('./inventory');

const { round2 } = pricing;

/** Merge duplicate product lines (e.g. the same strip scanned twice becomes qty 2, not two lines). */
function mergeItems(items) {
  const map = new Map();
  for (const it of items) {
    const key = `${it.productId}|${it.batchId || ''}|${it.unitPrice ?? ''}`;
    const prev = map.get(key);
    if (prev) prev.qty += it.qty;
    else map.set(key, { ...it });
  }
  return [...map.values()];
}

/**
 * Price the cart. Prices always come from the database - never from the client -
 * except an explicit, permission-checked POS price override.
 */
async function priceLines(rawItems, { channel, priceTier, allowOverride = false, user } = {}) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new ApiError(400, 'Cart is empty');
  if (rawItems.length > 100) throw new ApiError(400, 'Too many lines in one bill');
  const items = mergeItems(rawItems.map((i) => ({ ...i, qty: Number(i.qty) })));
  const ids = [...new Set(items.map((i) => String(i.productId)))];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new ApiError(400, 'Invalid product in cart');
  const products = await Product.find({ _id: { $in: ids } }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const catIds = [...new Set(products.map((p) => p.category && String(p.category)).filter(Boolean))];
  const cats = await Category.find({ _id: { $in: catIds } }).lean();
  const catDisc = new Map(cats.map((c) => [String(c._id), c.active ? c.discountPercent || 0 : 0]));

  return items.map((it) => {
    const p = byId.get(String(it.productId));
    if (!p || !p.active) throw new ApiError(400, 'A product in your cart is no longer available');
    if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 1000) throw new ApiError(400, `Invalid quantity for ${p.name}`);
    if (channel === 'online' && !p.onlineSaleAllowed) throw new ApiError(400, `${p.name} cannot be sold online. Please visit the store.`);
    if (channel === 'wholesale' && it.qty < (p.minWholesaleQty || 1)) throw new ApiError(400, `Minimum wholesale quantity for ${p.name} is ${p.minWholesaleQty}`);
    const price = pricing.unitPrice(p, { channel, qty: it.qty, categoryDiscountPercent: catDisc.get(String(p.category)) || 0, priceTier });
    let unitPrice = price.unitPrice;
    let priceOverride;
    if (it.unitPrice != null && Number(it.unitPrice) !== unitPrice) {
      if (!allowOverride) throw new ApiError(403, 'You are not allowed to change prices');
      const v = Number(it.unitPrice);
      if (!(v > 0) || v > price.mrp) throw new ApiError(400, `Price for ${p.name} must be between ₹0 and MRP ₹${price.mrp}`);
      if (!it.overrideReason) throw new ApiError(400, 'A reason is required for a price change');
      priceOverride = { by: user?._id, original: unitPrice, reason: String(it.overrideReason).slice(0, 200) };
      unitPrice = v;
    }
    return {
      product: p,
      productId: p._id,
      batchId: it.batchId,
      qty: it.qty,
      mrp: price.mrp,
      unitPrice,
      discountPercent: price.discountPercent,
      hasProductDiscount: price.hasProductDiscount || Boolean(priceOverride),
      gstRate: p.gstRate || 0,
      priceOverride,
    };
  });
}

async function resolveCoupon(code, { lines, storeId, userId, channel }) {
  if (!code) return { coupon: null, discount: 0 };
  const coupon = await Coupon.findOne({ code: String(code).trim().toUpperCase() }).lean();
  if (!coupon) throw new ApiError(400, 'Invalid coupon code');
  const userUsageCount = userId ? await CouponRedemption.countDocuments({ coupon: coupon._id, user: userId }) : 0;
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const r = pricing.evaluateCoupon(coupon, {
    now: new Date(),
    storeId,
    channel,
    subtotal,
    userUsageCount,
    items: lines.map((l) => ({ productId: l.productId, categoryId: l.product.category, lineTotal: l.unitPrice * l.qty, hasProductDiscount: l.hasProductDiscount })),
  });
  if (!r.ok) throw new ApiError(400, r.reason);
  return { coupon, discount: r.discount };
}

/** Atomically consume one coupon use (guards the global usage limit under concurrency). */
async function redeemCoupon(coupon, { userId, orderId, discount }) {
  if (!coupon) return;
  const filter = { _id: coupon._id, active: true };
  if (coupon.usageLimit) filter.usedCount = { $lt: coupon.usageLimit };
  const ok = await Coupon.findOneAndUpdate(filter, { $inc: { usedCount: 1 } });
  if (!ok) throw new ApiError(409, 'This coupon has just reached its usage limit');
  await CouponRedemption.create({ coupon: coupon._id, user: userId, order: orderId, discount });
}

/**
 * Create an order with stock taken (reserved for online/wholesale, deducted for POS).
 * Any failure after stock was taken rolls the stock back.
 */
async function createOrderWithStock({ channel, storeId, lines, couponCode, deliveryFee = 0, user, customerId, base, stockMode }) {
  const { coupon, discount } = await resolveCoupon(couponCode, { lines, storeId, userId: customerId, channel });
  const totals = pricing.computeTotals(lines, { couponDiscount: discount, deliveryFee });
  const orderId = new mongoose.Types.ObjectId();

  const takes = [];
  try {
    for (const l of lines) {
      const allocations = await inventory.takeStock({
        store: storeId,
        product: l.productId,
        qty: l.qty,
        mode: stockMode,
        movementType: stockMode === 'reserve' ? 'reserve' : 'pos_sale',
        refType: 'Order',
        refId: orderId,
        user: user?._id,
        preferredBatch: l.batchId,
        productName: l.product.name,
      });
      takes.push(allocations);
    }
  } catch (e) {
    await inventory.rollbackTakes(takes, stockMode);
    throw e;
  }

  const items = totals.lines.map((l, i) => ({
    product: l.productId,
    name: l.product.name,
    sku: l.product.sku,
    category: l.product.category,
    prescriptionRequired: l.product.prescriptionRequired,
    qty: l.qty,
    mrp: l.mrp,
    unitPrice: l.unitPrice,
    discountPercent: l.discountPercent,
    lineTotal: l.lineTotal,
    couponShare: l.couponShare,
    netAmount: l.netAmount,
    gstRate: l.gstRate,
    taxableAmount: l.taxableAmount,
    taxAmount: l.taxAmount,
    costTotal: round2(takes[i].reduce((s, a) => s + a.qty * (a.unitCost || 0), 0)),
    priceOverride: l.priceOverride,
    allocations: takes[i],
  }));

  try {
    const orderNumber = await nextNumber(`order-${channel}`, channel === 'pos' ? 'SP-POS' : channel === 'wholesale' ? 'SP-WS' : 'SP-ORD');
    const order = await Order.create({
      _id: orderId,
      orderNumber,
      channel,
      store: storeId,
      customer: customerId,
      items,
      mrpTotal: totals.mrpTotal,
      subtotal: totals.subtotal,
      productDiscount: totals.productDiscount,
      couponCode: coupon?.code,
      coupon: coupon?._id,
      couponDiscount: totals.couponDiscount,
      taxTotal: totals.taxTotal,
      deliveryFee: totals.deliveryFee,
      grandTotal: totals.grandTotal,
      prescriptionRequired: items.some((i) => i.prescriptionRequired),
      stockState: stockMode === 'reserve' ? 'reserved' : 'fulfilled',
      ...base,
    });
    if (coupon) await redeemCoupon(coupon, { userId: customerId, orderId: order._id, discount: totals.couponDiscount });
    return order;
  } catch (e) {
    await inventory.rollbackTakes(takes, stockMode);
    await Order.deleteOne({ _id: orderId }).catch(() => {});
    throw e;
  }
}

/** Release reserved stock of an order (cancel / reject). Idempotent via stockState. */
async function releaseOrderStock(order, user) {
  if (order.stockState !== 'reserved') return;
  for (const it of order.items) {
    await inventory.releaseReserved({ store: order.store, product: it.product, allocations: it.allocations, refType: 'Order', refId: order._id, user: user?._id });
  }
  order.stockState = 'released';
}

async function fulfilOrderStock(order, user) {
  if (order.stockState !== 'reserved') return;
  for (const it of order.items) {
    await inventory.fulfilReserved({ store: order.store, product: it.product, allocations: it.allocations, refType: 'Order', refId: order._id, user: user?._id });
  }
  order.stockState = 'fulfilled';
}

/** Next status once prescription + payment gates are satisfied. */
function gateStatus(order) {
  if (['pending', 'clarification'].includes(order.prescriptionStatus)) return 'prescription_review';
  if (order.prescriptionStatus === 'rejected') return 'cancelled';
  const online = ['phonepe', 'upi_gateway'].includes(order.payment.method);
  if (online && order.payment.status !== 'paid') return 'payment_pending';
  return 'confirmed';
}

// Staff-driven fulfilment transitions (gates are handled separately)
const TRANSITIONS = {
  confirmed: ['packing', 'cancelled'],
  packing: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['assigned', 'delivered', 'cancelled'], // 'delivered' = handed over at store (pickup)
  assigned: ['picked_up', 'ready_for_pickup', 'cancelled'],
  picked_up: ['out_for_delivery', 'delivery_failed'],
  out_for_delivery: ['delivered', 'delivery_failed'],
  delivery_failed: ['ready_for_pickup', 'out_for_delivery', 'cancelled'],
  payment_pending: ['cancelled'],
  prescription_review: ['cancelled'],
  placed: ['cancelled'],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

module.exports = { mergeItems, priceLines, resolveCoupon, createOrderWithStock, releaseOrderStock, fulfilOrderStock, gateStatus, canTransition, TRANSITIONS };
