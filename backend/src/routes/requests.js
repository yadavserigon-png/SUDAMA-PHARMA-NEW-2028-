// Medicine requests ("can you get me this?"), from web, app, phone or WhatsApp.
const express = require('express');
const MedicineRequest = require('../models/MedicineRequest');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { paginate } = require('../utils/paginate');
const { nextNumber } = require('../utils/sequence');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, optionalAuth, requirePermission } = require('../middleware/auth');
const { storeFilter, canAccessStore } = require('../middleware/storeScope');
const { privateDocUpload, checkFiles, fileMeta } = require('../middleware/upload');
const { notifyStoreStaff, sendWhatsAppText } = require('../services/notify');

const router = express.Router();

router.post('/', optionalAuth, privateDocUpload.array('files', 5), checkFiles, ah(async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid mobile number'),
    pincode: z.string().regex(/^\d{6}$/).optional().or(z.literal('')),
    text: z.string().trim().max(2000).optional(),
    storeId: z.string().optional(),
  }).parse(req.body);
  if (!body.text && !req.files?.length) throw new ApiError(400, 'Describe the medicine or attach a photo');
  const r = await MedicineRequest.create({
    number: await nextNumber('request', 'SP-MR'),
    customer: req.user?._id,
    name: body.name,
    phone: body.phone,
    pincode: body.pincode || undefined,
    text: body.text,
    store: body.storeId || undefined,
    files: (req.files || []).map((f) => fileMeta(f)),
    source: req.user ? 'web' : 'web',
  });
  if (r.store) await notifyStoreStaff(r.store, { type: 'medicine_request', title: `Medicine request ${r.number}`, body: r.text?.slice(0, 120) || 'Photo attached', link: '/admin/requests' });
  res.status(201).json({ number: r.number, _id: r._id, message: 'Request received. Our pharmacist will contact you shortly.' });
}));

router.use(authenticate);

router.get('/mine', ah(async (req, res) => {
  res.json(await MedicineRequest.find({ customer: req.user._id }).sort('-createdAt').limit(50).lean());
}));

router.get('/', requirePermission('requests.manage'), ah(async (req, res) => {
  const { page, limit, skip } = paginate(req);
  const sf = storeFilter(req);
  const filter = sf.store ? { $or: [sf, { store: { $exists: false } }, { store: null }] } : {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.source) filter.source = req.query.source;
  const [items, total] = await Promise.all([
    MedicineRequest.find(filter).populate('assignedTo', 'name').populate('order', 'orderNumber status').populate('items.product', 'name sku').sort('-createdAt').skip(skip).limit(limit).lean(),
    MedicineRequest.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

router.put('/:id', requirePermission('requests.manage'), validate(z.object({
  status: z.enum(['new', 'in_review', 'awaiting_customer', 'quoted', 'converted', 'unavailable', 'closed']).optional(),
  storeId: objectId.optional(),
  assignToMe: z.boolean().optional(),
  items: z.array(z.object({ name: z.string(), qty: z.number().int().min(1), product: objectId.optional() })).optional(),
  note: z.string().max(1000).optional(),
  orderId: objectId.optional(),
  customerConfirmed: z.boolean().optional(),
  messageCustomer: z.string().max(1000).optional(),
})), ah(async (req, res) => {
  const r = await MedicineRequest.findById(req.params.id);
  if (!r) throw new ApiError(404, 'Request not found');
  if (r.store && !canAccessStore(req.user, r.store)) throw new ApiError(403, 'No access to this store');
  const b = req.body;
  if (b.storeId) {
    if (!canAccessStore(req.user, b.storeId)) throw new ApiError(403, 'No access to this store');
    r.store = b.storeId;
  }
  if (b.status) r.status = b.status;
  if (b.assignToMe) r.assignedTo = req.user._id;
  if (b.items) r.items = b.items;
  if (b.orderId) { r.order = b.orderId; r.status = 'converted'; }
  if (b.customerConfirmed) r.customerConfirmedAt = new Date();
  if (b.note) r.notes.push({ by: req.user._id, text: b.note });
  let messageStatus;
  if (b.messageCustomer) {
    const sent = await sendWhatsAppText(r.phone, b.messageCustomer, { userId: req.user._id, customerId: r.customer });
    messageStatus = sent.status;
    r.notes.push({ by: req.user._id, text: `WhatsApp (${sent.status}): ${b.messageCustomer}` });
  }
  await r.save();
  await audit(req, 'medicine_request.updated', 'MedicineRequest', r._id, { status: r.status });
  res.json({ request: r, messageStatus });
}));

module.exports = router;
