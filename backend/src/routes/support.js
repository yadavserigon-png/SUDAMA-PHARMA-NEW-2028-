const express = require('express');
const SupportTicket = require('../models/SupportTicket');
const Order = require('../models/Order');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { paginate } = require('../utils/paginate');
const { nextNumber } = require('../utils/sequence');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, optionalAuth, requirePermission } = require('../middleware/auth');
const { storeFilter, canAccessStore } = require('../middleware/storeScope');
const { hasPermission } = require('../config/roles');
const { notifyUser } = require('../services/notify');

const router = express.Router();
const CATS = ['general', 'order', 'delivery_failure', 'damaged_product', 'wrong_product', 'refund', 'payment_dispute', 'prescription', 'other'];

// Customers (logged in or guests) open tickets
router.post('/', optionalAuth, validate(z.object({
  subject: z.string().trim().min(3).max(150),
  message: z.string().trim().min(5).max(3000),
  category: z.enum(CATS).default('general'),
  orderId: objectId.optional(),
  name: z.string().max(120).optional(),
  phone: z.string().regex(/^[6-9]\d{9}$/).optional(),
})), ah(async (req, res) => {
  const b = req.body;
  if (!req.user && !b.phone) throw new ApiError(400, 'Mobile number is required');
  let store;
  if (b.orderId) {
    const o = await Order.findById(b.orderId).lean();
    if (!o || (req.user && String(o.customer) !== String(req.user._id))) throw new ApiError(400, 'Order not found');
    store = o.store;
  }
  const t = await SupportTicket.create({
    number: await nextNumber('ticket', 'SP-TK'), customer: req.user?._id, name: req.user?.name || b.name, phone: req.user?.phone || b.phone, store, order: b.orderId,
    category: b.category, subject: b.subject, priority: ['payment_dispute', 'damaged_product', 'delivery_failure'].includes(b.category) ? 'high' : 'medium',
    messages: [{ by: req.user?._id, byName: req.user?.name || b.name, text: b.message }],
  });
  res.status(201).json({ _id: t._id, number: t.number });
}));

router.use(authenticate);

router.get('/mine', ah(async (req, res) => {
  const items = await SupportTicket.find({ customer: req.user._id }).sort('-updatedAt').limit(50).lean();
  for (const t of items) t.messages = t.messages.filter((m) => !m.internal);
  res.json(items);
}));

router.get('/', requirePermission('support.manage'), ah(async (req, res) => {
  const { page, limit, skip } = paginate(req);
  const sf = storeFilter(req);
  const filter = sf.store ? { $or: [sf, { store: { $exists: false } }, { store: null }] } : {};
  for (const k of ['status', 'priority', 'category']) if (req.query[k]) filter[k] = req.query[k];
  if (req.query.mine === 'true') filter.assignedTo = req.user._id;
  const [items, total] = await Promise.all([
    SupportTicket.find(filter).populate('assignedTo', 'name').populate('order', 'orderNumber').populate('store', 'code').sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    SupportTicket.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

async function load(req) {
  const t = await SupportTicket.findById(req.params.id);
  if (!t) throw new ApiError(404, 'Ticket not found');
  const own = String(t.customer) === String(req.user._id);
  const staff = hasPermission(req.user, 'support.manage') && (!t.store || canAccessStore(req.user, t.store));
  if (!own && !staff) throw new ApiError(404, 'Ticket not found');
  return { t, own, staff };
}

router.get('/:id', ah(async (req, res) => {
  const { t, staff } = await load(req);
  const o = t.toObject();
  if (!staff) o.messages = o.messages.filter((m) => !m.internal);
  res.json(o);
}));

router.post('/:id/messages', validate(z.object({ text: z.string().trim().min(1).max(3000), internal: z.boolean().optional() })), ah(async (req, res) => {
  const { t, staff } = await load(req);
  const internal = staff && req.body.internal;
  t.messages.push({ by: req.user._id, byName: req.user.name, text: req.body.text, internal });
  if (staff && !internal && t.status === 'open') t.status = 'in_progress';
  if (!staff && t.status === 'waiting_customer') t.status = 'in_progress';
  await t.save();
  if (staff && !internal && t.customer) await notifyUser({ _id: t.customer, phone: t.phone }, { type: 'support', title: `Support ${t.number}`, body: req.body.text.slice(0, 200) });
  res.json(t);
}));

router.put('/:id', requirePermission('support.manage'), validate(z.object({
  status: z.enum(['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  category: z.enum(CATS).optional(),
  assignedTo: objectId.optional().nullable(),
  resolution: z.string().max(2000).optional(),
})), ah(async (req, res) => {
  const { t } = await load(req);
  Object.assign(t, req.body);
  if (['resolved', 'closed'].includes(req.body.status)) {
    if (!t.resolution && !req.body.resolution) throw new ApiError(400, 'Add a resolution before closing');
    t.resolvedAt = new Date();
  }
  await t.save();
  await audit(req, 'support.updated', 'SupportTicket', t._id, req.body, t.store);
  res.json(t);
}));

module.exports = router;
