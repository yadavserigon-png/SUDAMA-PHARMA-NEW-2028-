const express = require('express');
const Prescription = require('../models/Prescription');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { paginate } = require('../utils/paginate');
const { z, validate } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { storeFilter, canAccessStore } = require('../middleware/storeScope');
const { privateDocUpload, checkFiles, fileMeta } = require('../middleware/upload');

const router = express.Router();
router.use(authenticate);

// Customer upload (camera photo or PDF). Stored privately; only the owner and authorised pharmacists can open it.
router.post('/', privateDocUpload.array('files', 5), checkFiles, ah(async (req, res) => {
  if (!req.files?.length) throw new ApiError(400, 'Attach at least one image or PDF of the prescription');
  const body = z.object({ patientName: z.string().max(120).optional(), doctorName: z.string().max(120).optional(), notes: z.string().max(500).optional(), storeId: z.string().optional() }).parse(req.body);
  const p = await Prescription.create({
    customer: req.user._id,
    files: req.files.map((f) => fileMeta(f)),
    patientName: body.patientName,
    doctorName: body.doctorName,
    notes: body.notes,
    store: body.storeId || undefined,
    source: req.headers['x-client'] === 'android' ? 'app' : 'web',
  });
  res.status(201).json(p);
}));

router.get('/mine', ah(async (req, res) => {
  res.json(await Prescription.find({ customer: req.user._id }).sort('-createdAt').limit(50).lean());
}));

// Pharmacist queue
router.get('/', requirePermission('prescriptions.review'), ah(async (req, res) => {
  const { page, limit, skip } = paginate(req);
  const sf = storeFilter(req);
  // un-routed prescriptions (no store yet) are visible to every pharmacist
  const filter = sf.store ? { $or: [sf, { store: { $exists: false } }, { store: null }] } : {};
  if (req.query.status) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    Prescription.find(filter).populate('customer', 'name phone').populate('orders', 'orderNumber status').populate('reviewedBy', 'name').sort('-createdAt').skip(skip).limit(limit).lean(),
    Prescription.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

// Standalone review (e.g. for counter use / future orders). Order-linked review is in /orders/:id/prescription-review.
router.post('/:id/review', requirePermission('prescriptions.review'), validate(z.object({
  decision: z.enum(['approved', 'rejected', 'clarification']),
  notes: z.string().trim().min(3).max(1000),
  doctorName: z.string().max(120).optional(),
  doctorRegNo: z.string().max(60).optional(),
  patientName: z.string().max(120).optional(),
  prescriptionDate: z.coerce.date().optional(),
  validTill: z.coerce.date().optional(),
})), ah(async (req, res) => {
  const p = await Prescription.findById(req.params.id);
  if (!p) throw new ApiError(404, 'Prescription not found');
  if (p.store && !canAccessStore(req.user, p.store)) throw new ApiError(403, 'No access to this store');
  const { decision, notes, ...rest } = req.body;
  Object.assign(p, rest, { status: decision, reviewNotes: notes, reviewedBy: req.user._id, reviewedAt: new Date() });
  await p.save();
  await audit(req, `prescription.${decision}`, 'Prescription', p._id, { notes });
  res.json(p);
}));

module.exports = router;
