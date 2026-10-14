const express = require('express');
const Refund = require('../models/Refund');
const Order = require('../models/Order');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { paginate } = require('../utils/paginate');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { storeFilter, assertStoreAccess } = require('../middleware/storeScope');
const { requestRefund } = require('../services/refunds');
const { round2 } = require('../services/pricing');
const { notifyUser } = require('../services/notify');

const router = express.Router();
router.use(authenticate);

router.get('/mine', ah(async (req, res) => {
  res.json(await Refund.find({ customer: req.user._id }).populate('order', 'orderNumber').sort('-createdAt').lean());
}));

router.get('/', requirePermission('refunds.request', 'refunds.approve', 'payments.manage'), ah(async (req, res) => {
  const { page, limit, skip } = paginate(req);
  const filter = storeFilter(req);
  if (req.query.status) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    Refund.find(filter).populate('order', 'orderNumber grandTotal channel payment').populate('requestedBy approvedBy', 'name').populate('store', 'code').sort('-createdAt').skip(skip).limit(limit).lean(),
    Refund.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

router.post('/', requirePermission('refunds.request'), validate(z.object({ orderId: objectId, amount: z.number().positive(), reason: z.string().trim().min(3).max(500), method: z.enum(['original', 'cash', 'bank_transfer', 'store_credit']).default('original') })), ah(async (req, res) => {
  const order = await Order.findById(req.body.orderId);
  if (!order) throw new ApiError(404, 'Order not found');
  assertStoreAccess(req.user, order.store);
  if (!['paid', 'partially_refunded'].includes(order.payment.status)) throw new ApiError(400, 'Only paid orders can be refunded');
  const r = await requestRefund(order, { amount: req.body.amount, reason: req.body.reason, user: req.user, method: req.body.method });
  if (!r) throw new ApiError(400, 'Nothing left to refund on this order');
  await audit(req, 'refund.requested', 'Refund', r._id, req.body, order.store);
  res.status(201).json(r);
}));

async function load(req) {
  const r = await Refund.findById(req.params.id);
  if (!r) throw new ApiError(404, 'Refund not found');
  assertStoreAccess(req.user, r.store);
  return r;
}

router.post('/:id/approve', requirePermission('refunds.approve'), validate(z.object({ approvedAmount: z.number().positive(), method: z.enum(['original', 'cash', 'bank_transfer', 'store_credit']).optional(), notes: z.string().max(500).optional() })), ah(async (req, res) => {
  const r = await load(req);
  if (r.status !== 'requested') throw new ApiError(400, 'Refund already decided');
  if (String(r.requestedBy) === String(req.user._id) && req.user.role !== 'super_admin') throw new ApiError(403, 'A different authorised person must approve this refund');
  const order = await Order.findById(r.order);
  const refundable = round2(order.grandTotal - (order.refundedAmount || 0));
  if (req.body.approvedAmount > Math.min(r.requestedAmount, refundable)) throw new ApiError(400, `Approved amount cannot exceed ₹${Math.min(r.requestedAmount, refundable)}`);
  Object.assign(r, { status: 'approved', approvedAmount: req.body.approvedAmount, approvedBy: req.user._id, approvedAt: new Date(), notes: req.body.notes });
  if (req.body.method) r.method = req.body.method;
  await r.save();
  await audit(req, 'refund.approved', 'Refund', r._id, req.body, r.store);
  res.json(r);
}));

router.post('/:id/reject', requirePermission('refunds.approve'), validate(z.object({ notes: z.string().trim().min(3).max(500) })), ah(async (req, res) => {
  const r = await load(req);
  if (r.status !== 'requested') throw new ApiError(400, 'Refund already decided');
  Object.assign(r, { status: 'rejected', approvedBy: req.user._id, approvedAt: new Date(), notes: req.body.notes });
  await r.save();
  await audit(req, 'refund.rejected', 'Refund', r._id, req.body, r.store);
  if (r.customer) await notifyUser({ _id: r.customer }, { type: 'refund', title: 'Refund update', body: `Your refund request ${r.number} was not approved: ${req.body.notes}` });
  res.json(r);
}));

// Record that money has actually been sent back (gateway refund dashboard / bank transfer / cash)
router.post('/:id/process', requirePermission('payments.manage'), validate(z.object({ paymentReference: z.string().trim().min(4).max(80) })), ah(async (req, res) => {
  const r = await load(req);
  if (r.status !== 'approved') throw new ApiError(400, 'Refund must be approved first');
  r.status = 'processed';
  r.paymentReference = req.body.paymentReference;
  r.processedAt = new Date();
  await r.save();
  const order = await Order.findById(r.order);
  order.refundedAmount = round2((order.refundedAmount || 0) + r.approvedAmount);
  order.payment.status = order.refundedAmount >= order.grandTotal ? 'refunded' : 'partially_refunded';
  await order.save();
  await audit(req, 'refund.processed', 'Refund', r._id, req.body, r.store);
  if (r.customer) await notifyUser({ _id: r.customer }, { type: 'refund', title: 'Refund processed', body: `₹${r.approvedAmount} refunded for order ${order.orderNumber}. Reference ${r.paymentReference}`, whatsapp: true });
  res.json(r);
}));

module.exports = router;
