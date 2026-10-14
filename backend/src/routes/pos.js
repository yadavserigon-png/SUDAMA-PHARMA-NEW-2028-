// Counter billing (POS): shifts, barcode scan, sale, cash reconciliation, daily counter report.
const express = require('express');
const mongoose = require('mongoose');
const Shift = require('../models/Shift');
const Product = require('../models/Product');
const Category = require('../models/Category');
const InventoryBatch = require('../models/InventoryBatch');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Prescription = require('../models/Prescription');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { assertStoreAccess, toId } = require('../middleware/storeScope');
const { hasPermission } = require('../config/roles');
const orderSvc = require('../services/orders');
const pricing = require('../services/pricing');
const { startOfDay, dayKey } = require('../services/stockRules');

const router = express.Router();
router.use(authenticate, requirePermission('pos.use'));

const { round2 } = pricing;

async function currentShift(userId, storeId) {
  return Shift.findOne({ user: userId, store: storeId, status: 'open' });
}

// ---------- Shifts ----------
router.get('/shift/current', ah(async (req, res) => {
  const storeId = req.query.storeId;
  assertStoreAccess(req.user, storeId);
  res.json(await currentShift(req.user._id, storeId));
}));

router.post('/shift/open', validate(z.object({ storeId: objectId, openingCash: z.number().min(0), counter: z.string().max(30).optional() })), ah(async (req, res) => {
  assertStoreAccess(req.user, req.body.storeId);
  if (await Shift.exists({ user: req.user._id, status: 'open' })) throw new ApiError(409, 'You already have an open shift. Close it first.');
  const s = await Shift.create({ store: req.body.storeId, user: req.user._id, openingCash: req.body.openingCash, counter: req.body.counter || 'Counter 1' });
  await audit(req, 'pos.shift_opened', 'Shift', s._id, { openingCash: s.openingCash }, s.store);
  res.status(201).json(s);
}));

router.post('/shift/close', validate(z.object({ storeId: objectId, countedCash: z.number().min(0), notes: z.string().max(300).optional() })), ah(async (req, res) => {
  const s = await currentShift(req.user._id, req.body.storeId);
  if (!s) throw new ApiError(404, 'No open shift');
  s.expectedCash = round2(s.openingCash + s.cashSales - s.cashRefunds);
  s.countedCash = req.body.countedCash;
  s.difference = round2(req.body.countedCash - s.expectedCash);
  s.closedAt = new Date();
  s.status = 'closed';
  s.notes = req.body.notes;
  await s.save();
  await audit(req, 'pos.shift_closed', 'Shift', s._id, { expected: s.expectedCash, counted: s.countedCash, difference: s.difference }, s.store);
  res.json(s);
}));

router.get('/shifts', ah(async (req, res) => {
  const filter = {};
  if (req.query.storeId) {
    assertStoreAccess(req.user, req.query.storeId);
    filter.store = req.query.storeId;
  }
  if (!hasPermission(req.user, 'reports.view')) filter.user = req.user._id;
  res.json(await Shift.find(filter).populate('user', 'name').populate('store', 'code').sort('-openedAt').limit(100).lean());
}));

// ---------- Scan / lookup ----------
router.get('/scan', ah(async (req, res) => {
  const { storeId } = req.query;
  assertStoreAccess(req.user, storeId);
  const code = String(req.query.code || '').trim();
  if (!code) throw new ApiError(400, 'Scan or type a barcode');
  const product = await Product.findOne({ $or: [{ barcodes: code }, { sku: code.toUpperCase() }] }).lean();
  if (!product) {
    return res.status(404).json({ error: `Unknown barcode "${code}". Do not sell until the product is verified and the barcode is registered.`, unknownBarcode: code, canRegister: hasPermission(req.user, 'barcodes.register') });
  }
  if (!product.active) throw new ApiError(400, `${product.name} is deactivated and cannot be sold`);
  res.json(await productForCounter(product, storeId));
}));

async function productForCounter(product, storeId) {
  const today = startOfDay(new Date());
  const batches = await InventoryBatch.find({ store: storeId, product: product._id, qtyAvailable: { $gt: 0 } }).sort({ expiryDate: 1 }).lean();
  const sellable = batches.filter((b) => b.status === 'active' && b.expiryDate > today);
  const blocked = batches.filter((b) => !(b.status === 'active' && b.expiryDate > today)).map((b) => ({ batchNo: b.batchNo, expiryDate: b.expiryDate, status: b.expiryDate <= today ? 'expired' : b.status, qty: b.qtyAvailable }));
  const cat = product.category ? await Category.findById(product.category).lean() : null;
  const price = pricing.unitPrice(product, { channel: 'pos', categoryDiscountPercent: cat?.discountPercent || 0 });
  const { taxable, tax } = pricing.splitInclusiveTax(price.unitPrice, product.gstRate);
  return {
    product: { _id: product._id, name: product.name, sku: product.sku, brand: product.brand, manufacturer: product.manufacturer, composition: product.composition, packSize: product.packSize, prescriptionRequired: product.prescriptionRequired, scheduleClass: product.scheduleClass, gstRate: product.gstRate, quantityDiscounts: product.quantityDiscounts },
    mrp: price.mrp,
    unitPrice: price.unitPrice,
    discountPercent: price.discountPercent,
    taxablePerUnit: taxable,
    taxPerUnit: tax,
    stock: sellable.reduce((s, b) => s + b.qtyAvailable, 0),
    batches: sellable.map((b) => ({ _id: b._id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: b.qtyAvailable, mrp: b.mrp })),
    suggestedBatch: sellable[0]?._id || null, // FEFO
    blockedBatches: blocked, // shown as warnings, never sellable
  };
}

router.get('/search', ah(async (req, res) => {
  const { storeId } = req.query;
  assertStoreAccess(req.user, storeId);
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const products = await Product.find({ active: true, $or: [{ name: rx }, { brand: rx }, { genericName: rx }, { composition: rx }, { sku: rx }] }).limit(15).lean();
  res.json(await Promise.all(products.map((p) => productForCounter(p, storeId))));
}));

// ---------- Sale ----------
const saleSchema = z.object({
  storeId: objectId,
  items: z.array(z.object({
    productId: objectId,
    qty: z.number().int().min(1).max(1000),
    batchId: objectId.optional(),
    unitPrice: z.number().min(0).optional(),
    overrideReason: z.string().max(200).optional(),
  })).min(1).max(100),
  customer: z.object({ name: z.string().max(120).optional(), phone: z.string().regex(/^[6-9]\d{9}$/).optional() }).optional(),
  couponCode: z.string().max(30).optional(),
  prescriptionId: objectId.optional(),
  pharmacistVerified: z.boolean().optional(),
  doctorName: z.string().max(120).optional(),
  payment: z.object({
    method: z.enum(['cash', 'card', 'upi_pos', 'credit']),
    cashTendered: z.number().min(0).optional(),
    reference: z.string().max(80).optional(),
  }),
  idempotencyKey: z.string().min(8).max(80),
});

router.post('/sale', validate(saleSchema), ah(async (req, res) => {
  const b = req.body;
  assertStoreAccess(req.user, b.storeId);
  const key = `pos:${req.user._id}:${b.idempotencyKey}`;
  const existing = await Order.findOne({ idempotencyKey: key });
  if (existing) return res.json(existing); // duplicate submit protection

  const shift = await currentShift(req.user._id, b.storeId);
  if (!shift) throw new ApiError(400, 'Open a shift before billing');

  const lines = await orderSvc.priceLines(b.items, { channel: 'pos', allowOverride: hasPermission(req.user, 'pos.price_override'), user: req.user });

  // Prescription validation for Rx items
  const rxLines = lines.filter((l) => l.product.prescriptionRequired);
  let prescription = null;
  if (rxLines.length) {
    if (b.prescriptionId) {
      prescription = await Prescription.findById(b.prescriptionId);
      if (!prescription || prescription.status !== 'approved') throw new ApiError(400, 'Prescription is not approved');
    } else if (!(b.pharmacistVerified && hasPermission(req.user, 'prescriptions.review'))) {
      throw new ApiError(400, `Prescription required for: ${rxLines.map((l) => l.product.name).join(', ')}. A pharmacist must verify the prescription at the counter.`);
    }
    const blocked = rxLines.filter((l) => ['X', 'narcotic'].includes(l.product.scheduleClass));
    if (blocked.length && !b.doctorName) throw new ApiError(400, 'Schedule X / narcotic items need prescriber details and register entry');
  }

  // Payment rules
  const pm = b.payment;
  if (['card', 'upi_pos'].includes(pm.method) && !pm.reference) throw new ApiError(400, 'Enter the terminal / UPI transaction reference after confirming the payment on the device');
  if (pm.method === 'credit' && !hasPermission(req.user, 'pos.price_override')) throw new ApiError(403, 'Credit sales require manager approval');

  // Validate cash before any stock is touched
  const { discount } = await orderSvc.resolveCoupon(b.couponCode, { lines, storeId: b.storeId, channel: 'pos' });
  const preview = pricing.computeTotals(lines, { couponDiscount: discount });
  if (pm.method === 'cash' && pm.cashTendered != null && pm.cashTendered < preview.grandTotal) {
    throw new ApiError(400, `Cash tendered ₹${pm.cashTendered} is less than the bill amount ₹${preview.grandTotal}`);
  }

  let customerId;
  if (b.customer?.phone) customerId = (await User.findOne({ phone: b.customer.phone }).select('_id').lean())?._id;

  const order = await orderSvc.createOrderWithStock({
    channel: 'pos', storeId: toId(b.storeId), lines, couponCode: b.couponCode, user: req.user, customerId, stockMode: 'deduct',
    base: {
      customerName: b.customer?.name,
      customerPhone: b.customer?.phone,
      deliveryType: 'counter',
      payment: { method: pm.method, status: pm.method === 'credit' ? 'pending' : 'paid', reference: pm.reference, paidAt: pm.method === 'credit' ? undefined : new Date() },
      prescriptionStatus: rxLines.length ? 'approved' : 'not_required',
      prescriptions: prescription ? [prescription._id] : [],
      status: 'completed',
      timeline: [{ status: 'completed', at: new Date(), by: req.user._id, note: rxLines.length && !prescription ? `Rx verified at counter by ${req.user.name}${b.doctorName ? ` (Dr. ${b.doctorName})` : ''}` : undefined }],
      cashier: req.user._id,
      shift: shift._id,
      idempotencyKey: key,
      completedAt: new Date(),
    },
  });

  if (pm.method === 'cash') {
    const tendered = pm.cashTendered ?? order.grandTotal;
    order.payment.cashTendered = tendered;
    order.payment.changeReturned = round2(Math.max(0, tendered - order.grandTotal));
  }
  await order.save();
  if (order.payment.status === 'paid') {
    await Payment.create({ order: order._id, store: order.store, customer: customerId, amount: order.grandTotal, method: pm.method, provider: pm.method === 'cash' ? 'cash' : pm.method === 'card' ? 'card' : 'pos_upi', status: 'success', providerReference: pm.reference, verifiedBy: 'cash_counter', verifiedByUser: req.user._id, verifiedAt: new Date() });
  }
  const isCash = pm.method === 'cash' && order.payment.status === 'paid';
  await Shift.updateOne({ _id: shift._id }, { $inc: { billCount: 1, cashSales: isCash ? order.grandTotal : 0, digitalSales: !isCash && order.payment.status === 'paid' ? order.grandTotal : 0 } });
  if (lines.some((l) => l.priceOverride)) await audit(req, 'pos.price_override', 'Order', order._id, { lines: lines.filter((l) => l.priceOverride).map((l) => ({ product: l.product.name, ...l.priceOverride })) }, order.store);
  res.status(201).json(order);
}));

// Sales return at the counter is handled by POST /api/orders/:id/return (quarantine + refund record);
// cash refunds paid at the counter are recorded against the current shift here:
router.post('/cash-refund', validate(z.object({ storeId: objectId, amount: z.number().positive(), refundId: objectId })), ah(async (req, res) => {
  const shift = await currentShift(req.user._id, req.body.storeId);
  if (!shift) throw new ApiError(400, 'Open a shift first');
  const Refund = require('../models/Refund');
  const r = await Refund.findById(req.body.refundId);
  if (!r || r.status !== 'approved' || r.method !== 'cash') throw new ApiError(400, 'Refund must be approved with method "cash"');
  if (String(r.store) !== String(req.body.storeId)) throw new ApiError(400, 'Refund belongs to another store');
  if (req.body.amount !== r.approvedAmount) throw new ApiError(400, 'Amount must equal the approved refund');
  r.status = 'processed';
  r.processedAt = new Date();
  r.paymentReference = `CASH-${shift._id}`;
  await r.save();
  const order = await Order.findById(r.order);
  order.refundedAmount = round2((order.refundedAmount || 0) + r.approvedAmount);
  order.payment.status = order.refundedAmount >= order.grandTotal ? 'refunded' : 'partially_refunded';
  await order.save();
  await Shift.updateOne({ _id: shift._id }, { $inc: { cashRefunds: r.approvedAmount } });
  await audit(req, 'pos.cash_refund', 'Refund', r._id, { amount: r.approvedAmount }, order.store);
  res.json(r);
}));

// ---------- Daily counter report ----------
router.get('/daily-report', ah(async (req, res) => {
  const { storeId } = req.query;
  assertStoreAccess(req.user, storeId);
  const day = req.query.date || dayKey(new Date());
  const from = new Date(`${day}T00:00:00+05:30`);
  const to = new Date(`${day}T23:59:59.999+05:30`);
  const match = { store: toId(storeId), channel: 'pos', completedAt: { $gte: from, $lte: to } };
  if (!hasPermission(req.user, 'reports.view')) match.cashier = req.user._id;
  const [byMethod, byCashier, totals] = await Promise.all([
    Order.aggregate([{ $match: match }, { $group: { _id: '$payment.method', amount: { $sum: '$grandTotal' }, bills: { $sum: 1 } } }]),
    Order.aggregate([{ $match: match }, { $group: { _id: '$cashier', amount: { $sum: '$grandTotal' }, bills: { $sum: 1 } } }, { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } }, { $project: { amount: 1, bills: 1, name: { $first: '$u.name' } } }]),
    Order.aggregate([{ $match: match }, { $group: { _id: null, gross: { $sum: '$grandTotal' }, discount: { $sum: { $add: ['$productDiscount', '$couponDiscount'] } }, tax: { $sum: '$taxTotal' }, bills: { $sum: 1 }, refunded: { $sum: '$refundedAmount' } } }]),
  ]);
  const shifts = await Shift.find({ store: storeId, openedAt: { $lte: to }, $or: [{ closedAt: { $gte: from } }, { status: 'open' }] }).populate('user', 'name').lean();
  res.json({ date: day, totals: totals[0] || { gross: 0, discount: 0, tax: 0, bills: 0, refunded: 0 }, byMethod, byCashier, shifts });
}));

module.exports = router;
