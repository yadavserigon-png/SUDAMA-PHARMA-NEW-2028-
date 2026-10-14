// Delivery partner app + delivery management (assignment, OTP proof, live tracking, performance).
const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const DeliveryAssignment = require('../models/DeliveryAssignment');
const LocationUpdate = require('../models/LocationUpdate');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { parseRange } = require('../utils/dates');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { storeFilter, assertStoreAccess, accessibleStoreIds, toId } = require('../middleware/storeScope');
const { privateDocUpload, checkFiles, fileMeta } = require('../middleware/upload');
const orderSvc = require('../services/orders');
const { haversineKm } = require('../services/geo');
const { notifyUser } = require('../services/notify');
const { round2 } = require('../services/pricing');

const router = express.Router();
router.use(authenticate);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const ACTIVE = ['assigned', 'accepted', 'picked_up', 'out_for_delivery'];

// ======================= PARTNER APP =======================
const partnerOnly = [requirePermission('delivery.self')];

router.get('/me', ...partnerOnly, ah(async (req, res) => {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const [active, todayDone, totals] = await Promise.all([
    DeliveryAssignment.countDocuments({ partner: req.user._id, status: { $in: ACTIVE } }),
    DeliveryAssignment.countDocuments({ partner: req.user._id, status: 'delivered', deliveredAt: { $gte: today } }),
    DeliveryAssignment.aggregate([{ $match: { partner: req.user._id, status: 'delivered' } }, { $group: { _id: null, earnings: { $sum: { $add: ['$earnings', '$incentive'] } }, count: { $sum: 1 }, codPending: { $sum: { $cond: ['$codSettled', 0, '$codCollected'] } } } }]),
  ]);
  res.json({ profile: req.user.toSafeJSON(), active, todayDelivered: todayDone, lifetime: totals[0] || { earnings: 0, count: 0, codPending: 0 } });
}));

router.post('/me/online', ...partnerOnly, validate(z.object({ online: z.boolean() })), ah(async (req, res) => {
  if (req.body.online && !req.user.deliveryProfile?.approved) throw new ApiError(403, 'Your profile is awaiting approval by the delivery manager');
  req.user.deliveryProfile.online = req.body.online;
  await req.user.save();
  res.json({ online: req.user.deliveryProfile.online });
}));

router.post('/me/documents', ...partnerOnly, privateDocUpload.single('file'), checkFiles, ah(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded');
  const docType = z.enum(['driving_licence', 'vehicle_rc', 'id_proof', 'photo', 'other']).parse(req.body.docType || 'other');
  req.user.deliveryProfile.documents.push({ ...fileMeta(req.file), docType, verified: false });
  await req.user.save();
  res.status(201).json(req.user.deliveryProfile.documents);
}));

router.get('/me/assignments', ...partnerOnly, ah(async (req, res) => {
  const history = req.query.history === 'true';
  const filter = { partner: req.user._id, status: history ? { $nin: ACTIVE } : { $in: ACTIVE } };
  const items = await DeliveryAssignment.find(filter)
    .populate({ path: 'order', select: 'orderNumber customerName customerPhone address grandTotal payment.method payment.status items.name items.qty deliveryType' })
    .populate('store', 'name code address location contact')
    .sort(history ? '-updatedAt' : 'createdAt').limit(history ? 100 : 30).lean();
  res.json(items);
}));

async function partnerAssignment(req, allowed) {
  const a = await DeliveryAssignment.findById(req.params.id).select('+otpHash');
  if (!a || String(a.partner) !== String(req.user._id)) throw new ApiError(404, 'Assignment not found');
  if (allowed && !allowed.includes(a.status)) throw new ApiError(400, `Not allowed while ${a.status}`);
  return a;
}

async function setOrderStatus(orderId, status, userId, note) {
  const order = await Order.findById(orderId);
  order.pushStatus(status, userId, note);
  return order;
}

router.post('/assignments/:id/accept', ...partnerOnly, ah(async (req, res) => {
  const a = await partnerAssignment(req, ['assigned']);
  a.status = 'accepted';
  a.events.push({ status: 'accepted' });
  await a.save();
  res.json(a);
}));

router.post('/assignments/:id/pickup', ...partnerOnly, validate(z.object({ lat: z.number().optional(), lng: z.number().optional() })), ah(async (req, res) => {
  const a = await partnerAssignment(req, ['assigned', 'accepted']);
  a.status = 'picked_up';
  a.trackingActive = true; // location sharing starts only now
  a.events.push({ status: 'picked_up', lat: req.body.lat, lng: req.body.lng });
  await a.save();
  const order = await setOrderStatus(a.order, 'picked_up', req.user._id);
  await order.save();
  res.json(a);
}));

router.post('/assignments/:id/out', ...partnerOnly, ah(async (req, res) => {
  const a = await partnerAssignment(req, ['picked_up']);
  a.status = 'out_for_delivery';
  a.events.push({ status: 'out_for_delivery' });
  await a.save();
  const order = await setOrderStatus(a.order, 'out_for_delivery', req.user._id);
  await order.save();
  if (order.customer) await notifyUser({ _id: order.customer, phone: order.customerPhone }, { type: 'order_status', title: `Order ${order.orderNumber}`, body: 'Out for delivery. Share the delivery OTP with the delivery partner only at handover.', whatsapp: true, orderId: order._id });
  res.json(a);
}));

router.post('/assignments/:id/deliver', ...partnerOnly, validate(z.object({ otp: z.string().regex(/^\d{4}$/), codCollected: z.number().min(0).optional(), lat: z.number().optional(), lng: z.number().optional() })), ah(async (req, res) => {
  const a = await partnerAssignment(req, ['out_for_delivery', 'picked_up']);
  if (a.otpAttempts >= 5) throw new ApiError(429, 'Too many wrong OTP attempts. Contact the store.');
  if (sha(`${a._id}:${req.body.otp}`) !== a.otpHash) {
    a.otpAttempts += 1;
    await a.save();
    throw new ApiError(400, 'Incorrect OTP');
  }
  const order = await Order.findById(a.order);
  if (order.payment.method === 'cod' && order.payment.status !== 'paid') {
    if (round2(req.body.codCollected || 0) !== round2(order.grandTotal)) throw new ApiError(400, `Collect ₹${order.grandTotal} cash before completing`);
    order.payment.status = 'paid';
    order.payment.paidAt = new Date();
    a.codCollected = order.grandTotal;
    await Payment.create({ order: order._id, store: order.store, customer: order.customer, amount: order.grandTotal, method: 'cash', provider: 'cod', status: 'success', verifiedBy: 'cash_counter', verifiedByUser: req.user._id, verifiedAt: new Date(), note: 'Cash collected by delivery partner (pending settlement)' });
  }
  if (order.payment.status !== 'paid') throw new ApiError(400, 'Payment is not confirmed for this order');
  await orderSvc.fulfilOrderStock(order, req.user);
  order.completedAt = new Date();
  order.pushStatus('delivered', req.user._id, 'Delivered with OTP');
  await order.save();
  a.status = 'delivered';
  a.deliveredAt = new Date();
  a.trackingActive = false; // stop location collection
  a.earnings = req.user.deliveryProfile?.ratePerDelivery || 0;
  a.events.push({ status: 'delivered', lat: req.body.lat, lng: req.body.lng });
  await a.save();
  if (order.customer) await notifyUser({ _id: order.customer, phone: order.customerPhone }, { type: 'order_status', title: `Order ${order.orderNumber}`, body: 'Delivered. Thank you for choosing Sudama Pharma!', whatsapp: true, orderId: order._id });
  res.json(a);
}));

router.post('/assignments/:id/fail', ...partnerOnly, validate(z.object({ reason: z.enum(['customer_unavailable', 'wrong_address', 'customer_refused', 'payment_issue', 'vehicle_issue', 'other']), note: z.string().max(300).optional() })), ah(async (req, res) => {
  const a = await partnerAssignment(req, ['picked_up', 'out_for_delivery']);
  a.status = 'failed';
  a.failureReason = `${req.body.reason}${req.body.note ? `: ${req.body.note}` : ''}`;
  a.trackingActive = false;
  a.events.push({ status: 'failed', note: a.failureReason });
  await a.save();
  const order = await setOrderStatus(a.order, 'delivery_failed', req.user._id, a.failureReason);
  await order.save();
  res.json(a);
}));

router.post('/assignments/:id/return-to-store', ...partnerOnly, ah(async (req, res) => {
  const a = await partnerAssignment(req, ['failed']);
  a.status = 'returned_to_store';
  a.events.push({ status: 'returned_to_store' });
  await a.save();
  res.json(a);
}));

// Real device GPS during an active delivery only
router.post('/location', ...partnerOnly, validate(z.object({ assignmentId: objectId, lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).optional() })), ah(async (req, res) => {
  const a = await DeliveryAssignment.findById(req.body.assignmentId).lean();
  if (!a || String(a.partner) !== String(req.user._id)) throw new ApiError(404, 'Assignment not found');
  if (!a.trackingActive || !['picked_up', 'out_for_delivery'].includes(a.status)) return res.json({ accepted: false, stopTracking: true });
  await LocationUpdate.create({ partner: req.user._id, assignment: a._id, lat: req.body.lat, lng: req.body.lng, accuracy: req.body.accuracy });
  await User.updateOne({ _id: req.user._id }, { $set: { 'deliveryProfile.lastLocation': { lat: req.body.lat, lng: req.body.lng, at: new Date() } } });
  res.json({ accepted: true });
}));

// ======================= MANAGEMENT =======================
const mgr = [requirePermission('delivery.manage')];

router.get('/partners', ...mgr, ah(async (req, res) => {
  const allowed = accessibleStoreIds(req.user);
  const filter = { role: 'delivery_partner' };
  if (req.query.storeId && req.query.storeId !== 'all') {
    assertStoreAccess(req.user, req.query.storeId);
    filter.stores = toId(req.query.storeId);
  } else if (allowed !== null) filter.stores = { $in: allowed.map(toId) };
  const partners = await User.find(filter).populate('stores', 'code name').lean();
  const active = await DeliveryAssignment.aggregate([{ $match: { partner: { $in: partners.map((p) => p._id) }, status: { $in: ACTIVE } } }, { $group: { _id: '$partner', n: { $sum: 1 }, tracking: { $max: '$trackingActive' } } }]);
  const amap = new Map(active.map((x) => [String(x._id), x]));
  res.json(partners.map((p) => {
    const act = amap.get(String(p._id));
    return {
      _id: p._id, name: p.name, phone: p.phone, active: p.active, stores: p.stores, deliveryProfile: { ...p.deliveryProfile, lastLocation: act?.tracking ? p.deliveryProfile?.lastLocation : undefined },
      activeAssignments: act?.n || 0,
    };
  }));
}));

router.post('/assign', ...mgr, validate(z.object({ orderId: objectId, partnerId: objectId })), ah(async (req, res) => {
  const order = await Order.findById(req.body.orderId);
  if (!order) throw new ApiError(404, 'Order not found');
  assertStoreAccess(req.user, order.store);
  if (order.deliveryType !== 'delivery') throw new ApiError(400, 'This is a store pickup order');
  if (!['ready_for_pickup', 'delivery_failed'].includes(order.status)) throw new ApiError(400, 'Order must be packed and ready before assigning a delivery partner');
  const partner = await User.findById(req.body.partnerId);
  if (!partner || partner.role !== 'delivery_partner' || !partner.active) throw new ApiError(400, 'Delivery partner not found or inactive');
  if (!partner.deliveryProfile?.approved) throw new ApiError(400, 'Delivery partner is not approved yet');
  if (!partner.stores.map(String).includes(String(order.store))) throw new ApiError(400, 'Partner is not attached to this store');
  if (order.delivery) await DeliveryAssignment.updateOne({ _id: order.delivery, status: { $in: [...ACTIVE, 'failed', 'returned_to_store'] } }, { status: 'cancelled', trackingActive: false });
  const otp = String(crypto.randomInt(1000, 9999));
  const a = new DeliveryAssignment({ order: order._id, store: order.store, partner: partner._id, assignedBy: req.user._id, events: [{ status: 'assigned' }] });
  a.otpHash = sha(`${a._id}:${otp}`);
  await a.save();
  order.delivery = a._id;
  order.deliveryOtp = otp;
  order.pushStatus('assigned', req.user._id, `Assigned to ${partner.name}`);
  await order.save();
  if (order.customer) await notifyUser({ _id: order.customer, phone: order.customerPhone }, { type: 'delivery_otp', title: `Delivery OTP for ${order.orderNumber}`, body: `Your delivery OTP is ${otp}. Share it only when you receive your order.`, whatsapp: true, orderId: order._id });
  await notifyUser(partner, { type: 'delivery_assigned', title: 'New delivery', body: `Order ${order.orderNumber}`, link: '/delivery' });
  await audit(req, 'delivery.assigned', 'Order', order._id, { partner: partner._id }, order.store);
  res.status(201).json(a);
}));

router.get('/active', ...mgr, ah(async (req, res) => {
  const sf = storeFilter(req);
  const items = await DeliveryAssignment.find({ ...sf, status: { $in: ACTIVE } })
    .populate('partner', 'name phone').populate('order', 'orderNumber address customerName status').populate('store', 'code name location').lean();
  const tracked = items.filter((a) => a.trackingActive).map((a) => a._id);
  const last = await LocationUpdate.aggregate([{ $match: { assignment: { $in: tracked } } }, { $sort: { at: -1 } }, { $group: { _id: '$assignment', lat: { $first: '$lat' }, lng: { $first: '$lng' }, at: { $first: '$at' }, accuracy: { $first: '$accuracy' } } }]);
  const lmap = new Map(last.map((l) => [String(l._id), l]));
  res.json(items.map((a) => {
    const l = lmap.get(String(a._id));
    const dest = a.order?.address?.lat != null ? { lat: a.order.address.lat, lng: a.order.address.lng } : null;
    return { ...a, location: l || null, distanceToCustomerKm: l && dest ? haversineKm(l, dest) : null };
  }));
}));

router.get('/assignments', ...mgr, ah(async (req, res) => {
  const filter = storeFilter(req);
  if (req.query.status) filter.status = req.query.status;
  if (req.query.partner && mongoose.isValidObjectId(req.query.partner)) filter.partner = toId(req.query.partner);
  res.json(await DeliveryAssignment.find(filter).populate('partner', 'name phone').populate('order', 'orderNumber grandTotal').populate('store', 'code').sort('-createdAt').limit(200).lean());
}));

router.post('/assignments/:id/settle-cod', requirePermission('delivery.manage', 'payments.manage'), validate(z.object({ amount: z.number().min(0), note: z.string().max(200).optional() })), ah(async (req, res) => {
  const a = await DeliveryAssignment.findById(req.params.id);
  if (!a) throw new ApiError(404, 'Assignment not found');
  assertStoreAccess(req.user, a.store);
  if (a.codSettled) throw new ApiError(400, 'Already settled');
  if (round2(req.body.amount) !== round2(a.codCollected)) throw new ApiError(400, `Settlement must equal collected cash ₹${a.codCollected}`);
  a.codSettled = true;
  a.events.push({ status: 'cod_settled', note: req.body.note });
  await a.save();
  await audit(req, 'delivery.cod_settled', 'DeliveryAssignment', a._id, req.body, a.store);
  res.json(a);
}));

router.post('/assignments/:id/incentive', ...mgr, validate(z.object({ amount: z.number().min(0), note: z.string().max(200).optional() })), ah(async (req, res) => {
  const a = await DeliveryAssignment.findById(req.params.id);
  if (!a) throw new ApiError(404, 'Assignment not found');
  assertStoreAccess(req.user, a.store);
  a.incentive = req.body.amount;
  a.events.push({ status: 'incentive', note: `₹${req.body.amount} ${req.body.note || ''}` });
  await a.save();
  await audit(req, 'delivery.incentive', 'DeliveryAssignment', a._id, req.body, a.store);
  res.json(a);
}));

router.get('/performance', ...mgr, ah(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const rows = await DeliveryAssignment.aggregate([
    { $match: { ...storeFilter(req), createdAt: { $gte: from, $lte: to } } },
    { $group: {
      _id: '$partner',
      assigned: { $sum: 1 },
      delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
      failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'returned_to_store']] }, 1, 0] } },
      earnings: { $sum: { $add: ['$earnings', '$incentive'] } },
      codCollected: { $sum: '$codCollected' },
      codUnsettled: { $sum: { $cond: ['$codSettled', 0, '$codCollected'] } },
      avgMinutes: { $avg: { $cond: [{ $eq: ['$status', 'delivered'] }, { $divide: [{ $subtract: ['$deliveredAt', '$createdAt'] }, 60000] }, null] } },
    } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
    { $project: { assigned: 1, delivered: 1, failed: 1, earnings: 1, codCollected: 1, codUnsettled: 1, avgMinutes: { $round: ['$avgMinutes', 0] }, name: { $first: '$u.name' }, phone: { $first: '$u.phone' } } },
    { $sort: { delivered: -1 } },
  ]);
  res.json({ from, to, partners: rows });
}));

module.exports = router;
