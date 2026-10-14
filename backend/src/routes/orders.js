// Online checkout + order lifecycle management.
// Cart -> Checkout -> Address validation -> Prescription review -> Payment verification
// -> Store assignment -> Stock reservation -> Packing -> Delivery assignment -> Pickup
// -> Out for delivery -> Delivered (+ cancellation, partial fulfilment, returns, refunds)
const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Store = require('../models/Store');
const Prescription = require('../models/Prescription');
const DeliveryAssignment = require('../models/DeliveryAssignment');
const LocationUpdate = require('../models/LocationUpdate');
const Payment = require('../models/Payment');
const SupportTicket = require('../models/SupportTicket');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { paginate, escapeRegex } = require('../utils/paginate');
const { nextNumber } = require('../utils/sequence');
const { parseRange } = require('../utils/dates');
const { z, validate, objectId, phone, pincode } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { storeFilter, assertStoreAccess, canAccessStore } = require('../middleware/storeScope');
const { hasPermission } = require('../config/roles');
const orderSvc = require('../services/orders');
const inventory = require('../services/inventory');
const { storeServes } = require('../services/geo');
const { getSetting } = require('../services/settings');
const { notifyUser, notifyStoreStaff } = require('../services/notify');
const { requestRefund } = require('../services/refunds');
const { invoicePdf } = require('../services/invoice');
const { round2 } = require('../services/pricing');

const router = express.Router();
router.use(authenticate);

const STATUS_TEXT = {
  prescription_review: 'Your prescription is being reviewed by our pharmacist.',
  payment_pending: 'Waiting for payment confirmation.',
  confirmed: 'Your order is confirmed.',
  packing: 'Your order is being packed.',
  ready_for_pickup: 'Your order is ready.',
  assigned: 'A delivery partner has been assigned.',
  picked_up: 'Your order has been picked up.',
  out_for_delivery: 'Your order is out for delivery.',
  delivered: 'Your order has been delivered. Get well soon!',
  cancelled: 'Your order has been cancelled.',
  delivery_failed: 'Delivery attempt failed. We will contact you.',
};

async function tellCustomer(order, status) {
  if (!order.customer || !STATUS_TEXT[status]) return;
  await notifyUser({ _id: order.customer, phone: order.customerPhone }, {
    type: 'order_status', title: `Order ${order.orderNumber}`, body: STATUS_TEXT[status], link: `/orders/${order._id}`, whatsapp: true, orderId: order._id,
  });
}

async function loadOrderForStaff(req, perm = 'orders.manage') {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Order not found');
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');
  if (!hasPermission(req.user, perm)) throw new ApiError(403, 'You do not have permission for this action');
  assertStoreAccess(req.user, order.store);
  return order;
}

// ======================= CHECKOUT =======================
const checkoutSchema = z.object({
  storeId: objectId.optional(),
  deliveryType: z.enum(['delivery', 'pickup']).default('delivery'),
  addressId: objectId.optional(),
  address: z.object({ name: z.string().min(2), phone, line1: z.string().min(3), line2: z.string().optional(), landmark: z.string().optional(), city: z.string().min(2), district: z.string().optional(), state: z.string().optional(), pincode, lat: z.number().optional(), lng: z.number().optional() }).optional(),
  items: z.array(z.object({ productId: objectId, qty: z.number().int().min(1).max(100) })).min(1).max(50),
  couponCode: z.string().max(30).optional(),
  paymentMethod: z.enum(['cod', 'phonepe']),
  prescriptionIds: z.array(objectId).max(5).optional(),
  idempotencyKey: z.string().min(8).max(80),
  notes: z.string().max(500).optional(),
});

// Price preview (no stock reserved)
router.post('/quote', validate(checkoutSchema.pick({ items: true, couponCode: true, storeId: true })), ah(async (req, res) => {
  const lines = await orderSvc.priceLines(req.body.items, { channel: 'online' });
  let couponDiscount = 0;
  let couponError;
  if (req.body.couponCode) {
    try {
      couponDiscount = (await orderSvc.resolveCoupon(req.body.couponCode, { lines, storeId: req.body.storeId, userId: req.user._id, channel: 'online' })).discount;
    } catch (e) {
      couponError = e.message;
    }
  }
  const { computeTotals } = require('../services/pricing');
  const t = computeTotals(lines, { couponDiscount });
  res.json({ ...t, lines: t.lines.map((l) => ({ productId: l.productId, name: l.product.name, qty: l.qty, mrp: l.mrp, unitPrice: l.unitPrice, lineTotal: l.lineTotal, prescriptionRequired: l.product.prescriptionRequired })), couponError, prescriptionRequired: lines.some((l) => l.product.prescriptionRequired) });
}));

router.post('/checkout', validate(checkoutSchema), ah(async (req, res) => {
  const b = req.body;
  const existing = await Order.findOne({ idempotencyKey: `${req.user._id}:${b.idempotencyKey}` });
  if (existing) return res.json(existing); // double-click / retry safe

  // 1. Address validation
  let address = b.address;
  if (b.addressId) {
    const a = req.user.addresses.id(b.addressId);
    if (!a) throw new ApiError(400, 'Saved address not found');
    address = { ...a.toObject(), name: a.name || req.user.name, phone: a.phone || req.user.phone };
  }
  if (b.deliveryType === 'delivery' && !address) throw new ApiError(400, 'Delivery address is required');

  // 2. Pricing (server-side only)
  const lines = await orderSvc.priceLines(b.items, { channel: 'online' });
  const rxNeeded = lines.some((l) => l.product.prescriptionRequired);

  // 3. Prescription presence (review happens by a pharmacist after placement)
  let prescriptions = [];
  if (rxNeeded) {
    if (!b.prescriptionIds?.length) throw new ApiError(400, 'This order contains prescription medicines. Please upload a valid prescription.');
    prescriptions = await Prescription.find({ _id: { $in: b.prescriptionIds }, customer: req.user._id, status: { $in: ['pending', 'approved', 'clarification'] } });
    if (!prescriptions.length) throw new ApiError(400, 'Uploaded prescription not found or was rejected');
  }

  // 4. Store assignment - serviceable store that has stock for every line
  const candidates = b.storeId ? await Store.find({ _id: b.storeId, active: true }).lean() : await Store.find({ active: true, acceptsOnlineOrders: true }).lean();
  let chosen = null;
  let serve = null;
  for (const s of candidates) {
    const sv = b.deliveryType === 'pickup' ? { ok: true, fee: 0 } : storeServes(s, { pincode: address.pincode, lat: address.lat, lng: address.lng });
    if (!sv.ok) continue;
    let ok = true;
    for (const l of lines) {
      if ((await inventory.availableQty(s._id, l.productId)) < l.qty) { ok = false; break; }
    }
    if (ok) { chosen = s; serve = sv; break; }
  }
  if (!chosen) {
    throw new ApiError(409, b.storeId
      ? 'The selected store cannot deliver to this address or does not have all items in stock.'
      : 'No store can currently deliver all items to this address. Try fewer items or another PIN code.');
  }

  // 5. Payment method rules
  const pay = await getSetting('payments');
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  let deliveryFee = b.deliveryType === 'delivery' ? serve.fee || 0 : 0;
  if (chosen.freeDeliveryAbove && subtotal >= chosen.freeDeliveryAbove) deliveryFee = 0;
  if (b.paymentMethod === 'cod') {
    if (!pay.codEnabled) throw new ApiError(400, 'Cash on delivery is currently unavailable');
    if (pay.codMaxAmount && subtotal + deliveryFee > pay.codMaxAmount) throw new ApiError(400, `Cash on delivery is available up to ₹${pay.codMaxAmount}`);
  }
  if (b.paymentMethod === 'phonepe' && !(pay.phonepeEnabled && require('../config/env').phonepe.configured)) throw new ApiError(400, 'Online payment is not available yet. Please choose cash on delivery.');

  // 6. Create order + reserve stock atomically per batch
  const order = await orderSvc.createOrderWithStock({
    channel: 'online', storeId: chosen._id, lines, couponCode: b.couponCode, deliveryFee, user: req.user, customerId: req.user._id, stockMode: 'reserve',
    base: {
      customerName: address?.name || req.user.name,
      customerPhone: address?.phone || req.user.phone,
      address: b.deliveryType === 'delivery' ? address : undefined,
      deliveryType: b.deliveryType,
      payment: { method: b.paymentMethod, status: 'pending' },
      prescriptions: prescriptions.map((p) => p._id),
      prescriptionStatus: rxNeeded ? 'pending' : 'not_required',
      idempotencyKey: `${req.user._id}:${b.idempotencyKey}`,
      notes: b.notes,
      timeline: [{ status: 'placed', at: new Date(), by: req.user._id }],
    },
  });
  order.pushStatus(orderSvc.gateStatus(order), req.user._id);
  await order.save();
  if (prescriptions.length) await Prescription.updateMany({ _id: { $in: prescriptions.map((p) => p._id) } }, { $addToSet: { orders: order._id }, $set: { store: chosen._id } });
  await notifyStoreStaff(chosen._id, { type: 'new_order', title: `New order ${order.orderNumber}`, body: `₹${order.grandTotal} • ${order.items.length} items${rxNeeded ? ' • Rx review needed' : ''}`, link: `/admin/orders/${order._id}` });
  await tellCustomer(order, order.status);
  res.status(201).json(order);
}));

// ======================= CUSTOMER VIEWS =======================
router.get('/my', ah(async (req, res) => {
  const { page, limit, skip } = paginate(req, { defaultLimit: 20 });
  const filter = { customer: req.user._id };
  const [items, total] = await Promise.all([
    Order.find(filter).select('-items.allocations -items.costTotal').populate('store', 'name code contact').sort('-createdAt').skip(skip).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

router.get('/:id', ah(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Order not found');
  const order = await Order.findById(req.params.id).select('+deliveryOtp').populate('store', 'name code address contact location').populate('prescriptions', 'status reviewNotes createdAt files').lean();
  if (!order) throw new ApiError(404, 'Order not found');
  const isOwner = String(order.customer) === String(req.user._id);
  // delivery OTP is visible only to the customer, and only while the order is with the partner
  if (!isOwner || !['assigned', 'picked_up', 'out_for_delivery'].includes(order.status)) delete order.deliveryOtp;
  const isStaff = hasPermission(req.user, 'orders.view') && canAccessStore(req.user, order.store._id);
  const delivery = order.delivery ? await DeliveryAssignment.findById(order.delivery).populate('partner', 'name phone').lean() : null;
  const isPartner = delivery && String(delivery.partner?._id) === String(req.user._id);
  if (!isOwner && !isStaff && !isPartner) throw new ApiError(404, 'Order not found');

  let liveLocation = null;
  // Live location is shown only while the partner is actively delivering this order (real GPS only)
  if (delivery && delivery.trackingActive && ['picked_up', 'out_for_delivery'].includes(delivery.status)) {
    const last = await LocationUpdate.findOne({ assignment: delivery._id }).sort('-at').lean();
    if (last && Date.now() - new Date(last.at).getTime() < 15 * 60 * 1000) liveLocation = { lat: last.lat, lng: last.lng, at: last.at };
  }
  if (!isStaff) {
    for (const it of order.items) {
      delete it.costTotal;
      delete it.allocations;
    }
  }
  const payments = isStaff || isOwner ? await Payment.find({ order: order._id }).select('amount provider status providerReference verifiedBy createdAt').sort('-createdAt').lean() : [];
  res.json({ ...order, delivery: delivery ? { _id: delivery._id, status: delivery.status, partner: delivery.partner ? { name: delivery.partner.name, phone: delivery.partner.phone } : null, events: delivery.events } : null, liveLocation, payments });
}));

router.post('/:id/cancel', validate(z.object({ reason: z.string().trim().min(3).max(300) })), ah(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');
  const isOwner = String(order.customer) === String(req.user._id);
  const isStaff = hasPermission(req.user, 'orders.manage') && canAccessStore(req.user, order.store);
  if (!isOwner && !isStaff) throw new ApiError(404, 'Order not found');
  const customerCancellable = ['placed', 'prescription_review', 'payment_pending', 'confirmed'];
  const staffCancellable = [...customerCancellable, 'packing', 'ready_for_pickup', 'assigned', 'delivery_failed'];
  if (!(isStaff ? staffCancellable : customerCancellable).includes(order.status)) throw new ApiError(400, 'This order can no longer be cancelled');
  await orderSvc.releaseOrderStock(order, req.user);
  order.cancelReason = req.body.reason;
  order.pushStatus('cancelled', req.user._id, req.body.reason);
  if (order.delivery) await DeliveryAssignment.updateOne({ _id: order.delivery }, { status: 'cancelled', trackingActive: false });
  let refund = null;
  if (order.payment.status === 'paid') refund = await requestRefund(order, { amount: order.grandTotal, reason: `Order cancelled: ${req.body.reason}`, user: req.user });
  await order.save();
  await audit(req, 'order.cancelled', 'Order', order._id, { reason: req.body.reason, by: isOwner ? 'customer' : 'staff' }, order.store);
  await tellCustomer(order, 'cancelled');
  res.json({ order, refund });
}));

// Customer return / refund request -> support ticket + refund request (physical return inspected by staff)
router.post('/:id/return-request', validate(z.object({ reason: z.string().trim().min(5).max(500), items: z.array(z.object({ itemId: objectId, qty: z.number().int().min(1) })).min(1) })), ah(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order || String(order.customer) !== String(req.user._id)) throw new ApiError(404, 'Order not found');
  if (order.status !== 'delivered' && order.status !== 'partially_returned') throw new ApiError(400, 'Returns can be requested only after delivery');
  const policy = await getSetting('payments');
  const days = policy.refundPolicyDays || 7;
  if (Date.now() - new Date(order.completedAt).getTime() > days * 86400000) throw new ApiError(400, `Return window of ${days} days has passed`);
  const lines = req.body.items.map((r) => {
    const it = order.items.id(r.itemId);
    if (!it || r.qty > it.qty - (it.returnedQty || 0)) throw new ApiError(400, 'Invalid return quantity');
    return `${it.name} x${r.qty}`;
  });
  const ticket = await SupportTicket.create({
    number: await nextNumber('ticket', 'SP-TK'), customer: req.user._id, name: req.user.name, phone: req.user.phone, store: order.store, order: order._id,
    category: 'refund', priority: 'medium', subject: `Return request for ${order.orderNumber}`,
    messages: [{ by: req.user._id, byName: req.user.name, text: `Items: ${lines.join(', ')}\nReason: ${req.body.reason}` }],
  });
  res.status(201).json({ ticket, message: 'Return request received. Our team will contact you to collect and inspect the items.' });
}));

router.get('/:id/invoice.pdf', ah(async (req, res) => {
  const order = await Order.findById(req.params.id).lean();
  if (!order) throw new ApiError(404, 'Order not found');
  const isOwner = String(order.customer) === String(req.user._id);
  const isStaff = (hasPermission(req.user, 'orders.view') || hasPermission(req.user, 'pos.use')) && canAccessStore(req.user, order.store);
  if (!isOwner && !isStaff) throw new ApiError(404, 'Order not found');
  if (!order.completedAt && order.channel !== 'pos') throw new ApiError(400, 'Invoice is available after delivery');
  const store = await Store.findById(order.store).lean();
  const branding = await getSetting('branding');
  invoicePdf(res, { order, store, branding, thermal: req.query.format === 'thermal' });
}));

// ======================= STAFF =======================
router.get('/', requirePermission('orders.view'), ah(async (req, res) => {
  const { page, limit, skip } = paginate(req);
  const filter = storeFilter(req);
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
  if (req.query.channel) filter.channel = req.query.channel;
  if (req.query.prescriptionStatus) filter.prescriptionStatus = req.query.prescriptionStatus;
  if (req.query.paymentStatus) filter['payment.status'] = req.query.paymentStatus;
  if (req.query.cashier && mongoose.isValidObjectId(req.query.cashier)) filter.cashier = new mongoose.Types.ObjectId(req.query.cashier);
  if (req.query.from || req.query.to) {
    const { from, to } = parseRange(req.query);
    filter.createdAt = { $gte: from, $lte: to };
  }
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ orderNumber: rx }, { customerPhone: rx }, { customerName: rx }];
  }
  const [items, total] = await Promise.all([
    Order.find(filter).select('-items.allocations').populate('store', 'code name').populate('cashier', 'name').sort('-createdAt').skip(skip).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

router.patch('/:id/status', validate(z.object({ status: z.string(), note: z.string().max(300).optional() })), ah(async (req, res) => {
  const order = await loadOrderForStaff(req);
  const to = req.body.status;
  if (to === 'cancelled') throw new ApiError(400, 'Use the cancel action (it releases stock and handles refunds)');
  if (['assigned', 'picked_up', 'out_for_delivery'].includes(to)) throw new ApiError(400, 'Use the delivery assignment workflow for this status');
  if (!orderSvc.canTransition(order.status, to)) throw new ApiError(400, `Cannot move order from ${order.status} to ${to}`);
  if (to === 'delivered') {
    // counter pickup handover
    if (order.deliveryType !== 'pickup') throw new ApiError(400, 'Home deliveries are completed by the delivery partner with OTP');
    if (order.payment.method === 'cod' && order.payment.status !== 'paid') {
      order.payment.status = 'paid';
      order.payment.paidAt = new Date();
      await Payment.create({ order: order._id, store: order.store, customer: order.customer, amount: order.grandTotal, method: 'cash', provider: 'cash', status: 'success', verifiedBy: 'cash_counter', verifiedByUser: req.user._id, verifiedAt: new Date() });
    }
    if (order.payment.status !== 'paid' && order.payment.method !== 'credit') throw new ApiError(400, 'Payment is not confirmed');
    await orderSvc.fulfilOrderStock(order, req.user);
    order.completedAt = new Date();
  }
  order.pushStatus(to, req.user._id, req.body.note);
  await order.save();
  await audit(req, 'order.status', 'Order', order._id, { to }, order.store);
  await tellCustomer(order, to);
  res.json(order);
}));

// Pharmacist decision on the prescription for this order (never automatic)
router.post('/:id/prescription-review', validate(z.object({ decision: z.enum(['approve', 'reject', 'clarify']), notes: z.string().trim().min(3).max(1000) })), ah(async (req, res) => {
  const order = await loadOrderForStaff(req, 'prescriptions.review');
  if (!order.prescriptionRequired) throw new ApiError(400, 'This order does not need a prescription');
  if (!['pending', 'clarification'].includes(order.prescriptionStatus)) throw new ApiError(400, 'Prescription already reviewed');
  const map = { approve: 'approved', reject: 'rejected', clarify: 'clarification' };
  order.prescriptionStatus = map[req.body.decision];
  await Prescription.updateMany({ _id: { $in: order.prescriptions } }, { status: map[req.body.decision], reviewedBy: req.user._id, reviewedAt: new Date(), reviewNotes: req.body.notes });
  if (req.body.decision === 'approve') {
    order.pushStatus(orderSvc.gateStatus(order), req.user._id, `Prescription approved: ${req.body.notes}`);
  } else if (req.body.decision === 'reject') {
    await orderSvc.releaseOrderStock(order, req.user);
    order.cancelReason = `Prescription rejected: ${req.body.notes}`;
    order.pushStatus('cancelled', req.user._id, order.cancelReason);
    if (order.payment.status === 'paid') await requestRefund(order, { amount: order.grandTotal, reason: order.cancelReason, user: req.user });
  } else {
    order.timeline.push({ status: 'prescription_clarification', by: req.user._id, note: req.body.notes, at: new Date() });
  }
  await order.save();
  await audit(req, `prescription.${map[req.body.decision]}`, 'Order', order._id, { notes: req.body.notes }, order.store);
  if (order.customer) {
    await notifyUser({ _id: order.customer, phone: order.customerPhone }, {
      type: 'prescription', title: `Prescription ${map[req.body.decision]}`, body: `Order ${order.orderNumber}: ${req.body.notes}`, link: `/orders/${order._id}`, whatsapp: true, orderId: order._id,
    });
  }
  res.json(order);
}));

// Partial fulfilment: ship fewer units than ordered (out-of-stock at packing etc.)
router.post('/:id/partial-fulfil', validate(z.object({ items: z.array(z.object({ itemId: objectId, fulfilQty: z.number().int().min(0) })).min(1), note: z.string().trim().min(3).max(300) })), ah(async (req, res) => {
  const order = await loadOrderForStaff(req);
  if (!['confirmed', 'packing'].includes(order.status)) throw new ApiError(400, 'Partial fulfilment is possible only while confirming/packing');
  if (order.stockState !== 'reserved') throw new ApiError(400, 'Stock is not reserved for this order');
  let reduction = 0;
  for (const r of req.body.items) {
    const it = order.items.id(r.itemId);
    if (!it || r.fulfilQty > it.qty) throw new ApiError(400, 'Invalid fulfil quantity');
    let toRelease = it.qty - r.fulfilQty;
    if (!toRelease) continue;
    const perUnitNet = it.netAmount / it.qty;
    const releaseAllocs = [];
    for (let i = it.allocations.length - 1; i >= 0 && toRelease > 0; i -= 1) {
      const a = it.allocations[i];
      const n = Math.min(a.qty, toRelease);
      releaseAllocs.push({ batch: a.batch, batchNo: a.batchNo, qty: n });
      a.qty -= n;
      toRelease -= n;
    }
    await inventory.releaseReserved({ store: order.store, product: it.product, allocations: releaseAllocs, refType: 'Order', refId: order._id, user: req.user._id });
    const ratio = r.fulfilQty / it.qty;
    reduction += round2(perUnitNet * (it.qty - r.fulfilQty));
    it.fulfilledQty = r.fulfilQty;
    it.costTotal = round2(it.allocations.reduce((s, a) => s + a.qty * (a.unitCost || 0), 0));
    it.lineTotal = round2(it.lineTotal * ratio);
    it.netAmount = round2(it.netAmount * ratio);
    it.taxableAmount = round2(it.taxableAmount * ratio);
    it.taxAmount = round2(it.taxAmount * ratio);
    it.couponShare = round2((it.couponShare || 0) * ratio);
    it.qty = r.fulfilQty;
    it.allocations = it.allocations.filter((a) => a.qty > 0);
  }
  order.items = order.items.filter((i) => i.qty > 0);
  if (!order.items.length) throw new ApiError(400, 'Cancel the order instead of fulfilling zero items');
  order.subtotal = round2(order.items.reduce((s, i) => s + i.lineTotal, 0));
  order.couponDiscount = round2(order.items.reduce((s, i) => s + (i.couponShare || 0), 0));
  order.taxTotal = round2(order.items.reduce((s, i) => s + i.taxAmount, 0));
  order.mrpTotal = round2(order.items.reduce((s, i) => s + (i.mrp || 0) * i.qty, 0));
  order.productDiscount = round2(order.mrpTotal - order.subtotal);
  const oldTotal = order.grandTotal;
  order.grandTotal = round2(order.subtotal - order.couponDiscount + (order.deliveryFee || 0));
  order.timeline.push({ status: 'partially_fulfilled', by: req.user._id, note: req.body.note, at: new Date() });
  let refund = null;
  if (order.payment.status === 'paid' && oldTotal > order.grandTotal) {
    refund = await requestRefund(order, { amount: round2(oldTotal - order.grandTotal), reason: `Partial fulfilment: ${req.body.note}`, user: req.user });
  }
  await order.save();
  await audit(req, 'order.partial_fulfilment', 'Order', order._id, { reduction }, order.store);
  res.json({ order, refund });
}));

// Physical return received at the store (online or POS bill) -> quarantine + refund request
router.post('/:id/return', validate(z.object({
  items: z.array(z.object({ itemId: objectId, qty: z.number().int().min(1) })).min(1),
  reason: z.string().trim().min(3).max(300),
  refundMethod: z.enum(['original', 'cash', 'bank_transfer', 'store_credit']).default('original'),
})), ah(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');
  if (!(hasPermission(req.user, 'orders.manage') || hasPermission(req.user, 'pos.use'))) throw new ApiError(403, 'Not allowed');
  assertStoreAccess(req.user, order.store);
  if (!['delivered', 'completed', 'partially_returned'].includes(order.status)) throw new ApiError(400, 'Only completed orders can be returned');
  let amount = 0;
  const refundItems = [];
  for (const r of req.body.items) {
    const it = order.items.id(r.itemId);
    if (!it) throw new ApiError(400, 'Item not found');
    if (r.qty > it.qty - (it.returnedQty || 0)) throw new ApiError(400, `Cannot return more than sold for ${it.name}`);
    // returned units go to quarantine on the batches they were sold from (latest first)
    let left = r.qty;
    for (const a of [...it.allocations].reverse()) {
      if (left <= 0) break;
      const n = Math.min(a.qty, left);
      await inventory.quarantineReturn({ store: order.store, product: it.product, batch: a.batch, batchNo: a.batchNo, qty: n, refType: 'OrderReturn', refId: order._id, user: req.user._id });
      left -= n;
    }
    it.returnedQty = (it.returnedQty || 0) + r.qty;
    amount += (it.netAmount / it.qty) * r.qty;
    refundItems.push({ product: it.product, qty: r.qty });
  }
  const allReturned = order.items.every((i) => (i.returnedQty || 0) >= i.qty);
  order.pushStatus(allReturned ? 'returned' : 'partially_returned', req.user._id, req.body.reason);
  await order.save();
  const refund = order.payment.status === 'paid' || order.payment.status === 'partially_refunded'
    ? await requestRefund(order, { amount: round2(amount), reason: `Return: ${req.body.reason}`, items: refundItems, user: req.user, method: req.body.refundMethod })
    : null;
  await audit(req, 'order.returned', 'Order', order._id, { amount: round2(amount), items: refundItems }, order.store);
  res.json({ order, refund, note: 'Returned units are in quarantine. Inspect them in Inventory before they can be sold again.' });
}));

module.exports = router;
