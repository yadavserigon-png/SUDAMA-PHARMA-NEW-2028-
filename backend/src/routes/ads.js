// Advertising (banners, sponsored products, category promotions, delivery recruitment)
// and partner onboarding applications (advertisers, delivery partners/services, wholesale buyers, suppliers).
const express = require('express');
const Advertisement = require('../models/Advertisement');
const PartnerApplication = require('../models/PartnerApplication');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { nextNumber } = require('../utils/sequence');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { hasPermission } = require('../config/roles');
const { publicImageUpload, privateDocUpload, checkFiles, fileMeta } = require('../middleware/upload');

const router = express.Router();
const PLACEMENTS = ['homepage_banner', 'category_promotion', 'sponsored_product', 'delivery_recruitment', 'service_partner'];

// Words that make medicine ads misleading / unlawful (Drugs and Magic Remedies Act etc.). Staff still review every ad.
const PROHIBITED = /\b(cure|guaranteed|100%|miracle|permanent(ly)? (cure|remove)|no side effects?|instant(ly)? cure|sexual|fairness|weight loss in \d+)\b/i;

// ---------- Public: active, approved, in-date ads (always labelled as sponsored by the UI) ----------
router.get('/active', ah(async (req, res) => {
  const now = new Date();
  const filter = { status: 'approved', complianceChecked: true, $and: [{ $or: [{ startAt: null }, { startAt: { $lte: now } }] }, { $or: [{ endAt: null }, { endAt: { $gte: now } }] }] };
  if (req.query.placement) filter.placement = req.query.placement;
  if (req.query.category) filter.category = req.query.category;
  const ads = await Advertisement.find(filter).select('title placement category product creative headline body linkUrl advertiserName').limit(10).lean();
  res.json(ads.map((a) => ({ ...a, sponsored: true })));
}));

router.post('/:id/impression', ah(async (req, res) => {
  await Advertisement.updateOne({ _id: req.params.id, status: 'approved' }, { $inc: { impressions: 1 } });
  res.json({ ok: true });
}));
router.post('/:id/click', ah(async (req, res) => {
  await Advertisement.updateOne({ _id: req.params.id, status: 'approved' }, { $inc: { clicks: 1 } });
  res.json({ ok: true });
}));

// ---------- Public partner applications ----------
router.post('/applications', privateDocUpload.array('documents', 5), checkFiles, ah(async (req, res) => {
  const b = z.object({
    type: z.enum(['advertiser', 'delivery_partner', 'delivery_service', 'wholesale_buyer', 'supplier']),
    name: z.string().trim().min(2).max(120),
    phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid mobile number'),
    email: z.string().email().optional().or(z.literal('')),
    businessName: z.string().max(160).optional(),
    gstin: z.string().max(15).optional(),
    licenseNo: z.string().max(60).optional(),
    city: z.string().max(80).optional(),
    district: z.string().max(80).optional(),
    message: z.string().max(2000).optional(),
  }).parse(req.body);
  const app = await PartnerApplication.create({ ...b, email: b.email || undefined, documents: (req.files || []).map((f) => fileMeta(f)) });
  res.status(201).json({ _id: app._id, message: 'Application received. Our team will verify your details and contact you.' });
}));

router.use(authenticate);

// ---------- Advertiser self-service ----------
router.get('/mine', requirePermission('ads.self'), ah(async (req, res) => {
  res.json(await Advertisement.find({ advertiser: req.user._id }).sort('-createdAt').lean());
}));

const adSchema = z.object({
  title: z.string().trim().min(3).max(120),
  placement: z.enum(PLACEMENTS),
  category: objectId.optional(),
  product: objectId.optional(),
  headline: z.string().max(120).optional(),
  body: z.string().max(500).optional(),
  linkUrl: z.string().url().optional().or(z.literal('')),
  budget: z.coerce.number().min(0).optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  advertiserName: z.string().max(120).optional(),
});

router.post('/', requirePermission('ads.self', 'ads.manage'), publicImageUpload.single('creative'), checkFiles, ah(async (req, res) => {
  const b = adSchema.parse(req.body);
  if (req.user.role === 'advertiser' && !req.user.advertiser?.verified) throw new ApiError(403, 'Your advertiser account must be verified before submitting campaigns');
  const text = `${b.title} ${b.headline || ''} ${b.body || ''}`;
  if (PROHIBITED.test(text)) throw new ApiError(400, 'Ad text contains claims that are not permitted for health products (e.g. "cure", "guaranteed", "100%")');
  const ad = await Advertisement.create({
    ...b,
    linkUrl: b.linkUrl || undefined,
    advertiser: req.user.role === 'advertiser' ? req.user._id : undefined,
    advertiserName: b.advertiserName || req.user.advertiser?.businessName || req.user.name,
    creative: req.file ? `/uploads/public/${req.file.filename}` : undefined,
    status: 'submitted',
  });
  res.status(201).json(ad);
}));

// ---------- Admin ----------
router.get('/', requirePermission('ads.manage'), ah(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  res.json(await Advertisement.find(filter).populate('advertiser', 'name phone').populate('reviewedBy', 'name').sort('-createdAt').limit(300).lean());
}));

router.post('/:id/review', requirePermission('ads.manage'), validate(z.object({
  decision: z.enum(['approved', 'rejected', 'paused', 'ended']),
  complianceChecked: z.boolean().optional(),
  notes: z.string().max(500).optional(),
})), ah(async (req, res) => {
  const ad = await Advertisement.findById(req.params.id);
  if (!ad) throw new ApiError(404, 'Ad not found');
  if (req.body.decision === 'approved' && !req.body.complianceChecked) throw new ApiError(400, 'Confirm the ad has been checked for misleading or prohibited medical claims');
  ad.status = req.body.decision;
  if (req.body.complianceChecked !== undefined) ad.complianceChecked = req.body.complianceChecked;
  ad.reviewNotes = req.body.notes;
  ad.reviewedBy = req.user._id;
  await ad.save();
  await audit(req, `ad.${req.body.decision}`, 'Advertisement', ad._id, req.body);
  res.json(ad);
}));

router.post('/:id/invoice', requirePermission('ads.manage'), validate(z.object({ amount: z.number().min(0), status: z.enum(['invoiced', 'paid']) })), ah(async (req, res) => {
  const ad = await Advertisement.findById(req.params.id);
  if (!ad) throw new ApiError(404, 'Ad not found');
  ad.invoice = { number: ad.invoice?.number || (await nextNumber('ad-invoice', 'SP-ADV')), amount: req.body.amount, status: req.body.status, paidAt: req.body.status === 'paid' ? new Date() : undefined };
  await ad.save();
  await audit(req, 'ad.invoice', 'Advertisement', ad._id, req.body);
  res.json(ad);
}));

router.get('/applications/list', ah(async (req, res) => {
  const types = [];
  if (hasPermission(req.user, 'ads.manage')) types.push('advertiser', 'delivery_service');
  if (hasPermission(req.user, 'delivery.manage')) types.push('delivery_partner', 'delivery_service');
  if (hasPermission(req.user, 'wholesale.manage')) types.push('wholesale_buyer');
  if (hasPermission(req.user, 'suppliers.manage')) types.push('supplier');
  if (!types.length) throw new ApiError(403, 'No access');
  const filter = { type: { $in: types } };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.type) filter.type = req.query.type;
  res.json(await PartnerApplication.find(filter).sort('-createdAt').limit(300).lean());
}));

router.put('/applications/:id', validate(z.object({ status: z.enum(['under_review', 'approved', 'rejected']), reviewNotes: z.string().max(1000).optional(), linkedUser: objectId.optional() })), ah(async (req, res) => {
  const app = await PartnerApplication.findById(req.params.id);
  if (!app) throw new ApiError(404, 'Application not found');
  const perm = { advertiser: 'ads.manage', delivery_service: 'ads.manage', delivery_partner: 'delivery.manage', wholesale_buyer: 'wholesale.manage', supplier: 'suppliers.manage' }[app.type];
  if (!hasPermission(req.user, perm) && !(app.type === 'delivery_service' && hasPermission(req.user, 'delivery.manage'))) throw new ApiError(403, 'No access');
  Object.assign(app, req.body, { reviewedBy: req.user._id });
  await app.save();
  await audit(req, `application.${req.body.status}`, 'PartnerApplication', app._id, req.body);
  res.json({ application: app, next: req.body.status === 'approved' ? 'Create the user account for this partner from Users (role: advertiser / delivery partner / wholesale buyer) after verifying documents.' : undefined });
}));

module.exports = router;
