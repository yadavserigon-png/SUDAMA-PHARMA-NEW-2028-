const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { paginate } = require('../utils/paginate');
const { parseRange } = require('../utils/dates');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { storeFilter, assertStoreAccess, canAccessStore } = require('../middleware/storeScope');
const { hasPermission } = require('../config/roles');
const phonepe = require('../services/phonepe');
const orderSvc = require('../services/orders');
const { round2 } = require('../services/pricing');
const { notifyStoreStaff } = require('../services/notify');

const router = express.Router();

/** Apply a VERIFIED gateway status to the payment + order. Idempotent. */
async function applyGatewayStatus(payment, status) {
  if (payment.status === 'success') return payment;
  const order = await Order.findById(payment.order);
  if (status.success) {
    if (Number(status.amountPaise) !== Math.round(payment.amount * 100)) {
      payment.status = 'failed';
      payment.note = `Amount mismatch: gateway ${status.amountPaise} paise vs expected ${Math.round(payment.amount * 100)}`;
      payment.raw = status.raw;
      await payment.save();
      await notifyStoreStaff(order.store, { type: 'payment_alert', title: `Payment amount mismatch ${order.orderNumber}`, body: payment.note });
      return payment;
    }
    payment.status = 'success';
    payment.providerReference = status.providerReference;
    payment.verifiedBy = 'gateway_status_api';
    payment.verifiedAt = new Date();
    payment.raw = status.raw;
    await payment.save();
    if (order.payment.status !== 'paid') {
      order.payment.status = 'paid';
      order.payment.reference = status.providerReference;
      order.payment.paidAt = new Date();
      if (order.status === 'payment_pending') order.pushStatus(orderSvc.gateStatus(order), undefined, 'Payment verified with PhonePe');
      await order.save();
    }
  } else if (!status.pending) {
    payment.status = 'failed';
    payment.raw = status.raw;
    await payment.save();
  }
  return payment;
}

// ---------- PhonePe ----------
router.post('/phonepe/initiate', authenticate, validate(z.object({ orderId: objectId })), ah(async (req, res) => {
  const order = await Order.findById(req.body.orderId);
  if (!order || String(order.customer) !== String(req.user._id)) throw new ApiError(404, 'Order not found');
  if (order.payment.method !== 'phonepe') throw new ApiError(400, 'This order is not set for online payment');
  if (order.payment.status === 'paid') throw new ApiError(400, 'Order is already paid');
  if (['cancelled', 'returned'].includes(order.status)) throw new ApiError(400, 'Order is cancelled');
  const merchantTransactionId = `SP${Date.now()}${crypto.randomBytes(4).toString('hex')}`.toUpperCase().slice(0, 34); // <= 35 chars, alphanumeric
  const payment = await Payment.create({ order: order._id, store: order.store, customer: req.user._id, amount: order.grandTotal, method: 'upi_gateway', provider: 'phonepe', status: 'created', merchantTransactionId });
  const r = await phonepe.initiatePayment({
    merchantTransactionId,
    amountPaise: Math.round(order.grandTotal * 100),
    userId: req.user._id,
    mobile: req.user.phone,
    redirectUrl: `${env.appBaseUrl}/payment/return?txn=${merchantTransactionId}&order=${order._id}`,
    callbackUrl: `${env.apiBaseUrl}/api/payments/phonepe/callback`,
  });
  payment.status = 'pending';
  if (r.providerOrderId) payment.providerReference = r.providerOrderId;
  await payment.save();
  res.json({ redirectUrl: r.redirectUrl, merchantTransactionId });
}));

// Server-to-server notification from PhonePe (webhook). Verified, then the status API is re-checked.
router.post('/phonepe/callback', ah(async (req, res) => {
  const v = phonepe.verifyWebhook(req);
  if (!v.ok || !v.merchantTransactionId) throw new ApiError(400, 'Invalid callback signature');
  const payment = await Payment.findOne({ merchantTransactionId: v.merchantTransactionId });
  if (!payment) throw new ApiError(404, 'Unknown transaction');
  await applyGatewayStatus(payment, await phonepe.checkStatus(v.merchantTransactionId));
  res.json({ ok: true });
}));

// Customer returns from PhonePe -> frontend asks the server to check (never trusts the redirect)
router.get('/phonepe/status/:txn', authenticate, ah(async (req, res) => {
  const payment = await Payment.findOne({ merchantTransactionId: req.params.txn });
  if (!payment) throw new ApiError(404, 'Transaction not found');
  const isOwner = String(payment.customer) === String(req.user._id);
  if (!isOwner && !(hasPermission(req.user, 'payments.view') && canAccessStore(req.user, payment.store))) throw new ApiError(404, 'Transaction not found');
  if (payment.status !== 'success' && env.phonepe.configured) await applyGatewayStatus(payment, await phonepe.checkStatus(payment.merchantTransactionId));
  res.json({ status: payment.status, orderId: payment.order, note: payment.note });
}));

// ---------- Staff verification against bank / UPI merchant statement ----------
router.post('/manual-verify', authenticate, requirePermission('payments.manage'), validate(z.object({
  orderId: objectId,
  amount: z.number().positive(),
  reference: z.string().trim().min(6).max(80), // UTR / bank reference seen in the merchant statement
  note: z.string().trim().min(5).max(300),
})), ah(async (req, res) => {
  const order = await Order.findById(req.body.orderId);
  if (!order) throw new ApiError(404, 'Order not found');
  assertStoreAccess(req.user, order.store);
  if (order.payment.status === 'paid') throw new ApiError(400, 'Order already paid');
  if (round2(req.body.amount) !== round2(order.grandTotal)) throw new ApiError(400, `Amount must equal the order total ₹${order.grandTotal}`);
  if (await Payment.exists({ providerReference: req.body.reference, status: 'success' })) throw new ApiError(409, 'This bank reference has already been used for another payment');
  await Payment.create({ order: order._id, store: order.store, customer: order.customer, amount: order.grandTotal, method: 'upi', provider: 'manual_bank', status: 'success', providerReference: req.body.reference, verifiedBy: 'staff_bank_check', verifiedByUser: req.user._id, verifiedAt: new Date(), note: req.body.note });
  order.payment.status = 'paid';
  order.payment.reference = req.body.reference;
  order.payment.paidAt = new Date();
  if (order.status === 'payment_pending') order.pushStatus(orderSvc.gateStatus(order), req.user._id, `Payment verified in bank statement (${req.body.reference})`);
  await order.save();
  await audit(req, 'payment.manual_verified', 'Order', order._id, req.body, order.store);
  res.json(order);
}));

// ---------- Transaction history + reconciliation ----------
router.get('/', authenticate, requirePermission('payments.view', 'payments.manage'), ah(async (req, res) => {
  const { page, limit, skip } = paginate(req);
  const filter = storeFilter(req);
  if (req.query.status) filter.status = req.query.status;
  if (req.query.provider) filter.provider = req.query.provider;
  if (req.query.from || req.query.to) {
    const { from, to } = parseRange(req.query);
    filter.createdAt = { $gte: from, $lte: to };
  }
  const [items, total] = await Promise.all([
    Payment.find(filter).populate('order', 'orderNumber grandTotal channel').populate('store', 'code').populate('verifiedByUser', 'name').sort('-createdAt').skip(skip).limit(limit).lean(),
    Payment.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

router.get('/reconciliation', authenticate, requirePermission('payments.view', 'payments.manage'), ah(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const sf = storeFilter(req);
  const [byProvider, paidOrdersWithoutPayment, successPaymentsOrderUnpaid, pendingOld] = await Promise.all([
    Payment.aggregate([{ $match: { ...sf, createdAt: { $gte: from, $lte: to } } }, { $group: { _id: { provider: '$provider', status: '$status' }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Order.aggregate([
      { $match: { ...sf, 'payment.status': 'paid', 'payment.method': { $ne: 'credit' }, createdAt: { $gte: from, $lte: to } } },
      { $lookup: { from: 'payments', let: { o: '$_id' }, pipeline: [{ $match: { $expr: { $eq: ['$order', '$$o'] }, status: 'success' } }], as: 'p' } },
      { $match: { p: { $size: 0 } } },
      { $project: { orderNumber: 1, grandTotal: 1, channel: 1 } },
    ]),
    Payment.aggregate([
      { $match: { ...sf, status: 'success', createdAt: { $gte: from, $lte: to } } },
      { $lookup: { from: 'orders', localField: 'order', foreignField: '_id', as: 'o' } },
      { $unwind: '$o' },
      { $match: { 'o.payment.status': { $nin: ['paid', 'refunded', 'partially_refunded'] } } },
      { $project: { amount: 1, provider: 1, 'o.orderNumber': 1 } },
    ]),
    Payment.find({ ...sf, status: { $in: ['created', 'pending'] }, createdAt: { $lt: new Date(Date.now() - 30 * 60000) } }).populate('order', 'orderNumber').limit(100).lean(),
  ]);
  res.json({ from, to, byProvider, issues: { paidOrdersWithoutPayment, successPaymentsOrderUnpaid, stalePendingPayments: pendingOld } });
}));

router.applyGatewayStatus = applyGatewayStatus;
module.exports = router;
