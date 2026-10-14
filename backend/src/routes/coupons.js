const express = require('express');
const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { accessibleStoreIds } = require('../middleware/storeScope');

const router = express.Router();

// Public offers page
router.get('/offers', ah(async (req, res) => {
  const now = new Date();
  const items = await Coupon.find({
    active: true, showOnOffersPage: true,
    $and: [{ $or: [{ startAt: null }, { startAt: { $lte: now } }] }, { $or: [{ endAt: null }, { endAt: { $gte: now } }] }],
  }).select('code title description type value maxDiscount minOrder endAt stores channels').sort('-createdAt').lean();
  res.json(items.filter((c) => !c.usageLimit || c.usedCount < c.usageLimit));
}));

router.use(authenticate, requirePermission('coupons.manage'));

const schema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/),
  title: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  type: z.enum(['percent', 'flat']),
  value: z.number().positive(),
  maxDiscount: z.number().positive().optional(),
  minOrder: z.number().min(0).optional(),
  stores: z.array(objectId).optional(),
  categories: z.array(objectId).optional(),
  products: z.array(objectId).optional(),
  channels: z.array(z.enum(['online', 'pos', 'wholesale'])).optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  usageLimit: z.number().int().positive().optional(),
  perUserLimit: z.number().int().positive().optional(),
  stackWithProductDiscounts: z.boolean().optional(),
  showOnOffersPage: z.boolean().optional(),
  active: z.boolean().optional(),
});

function checkStores(user, stores) {
  const allowed = accessibleStoreIds(user);
  if (allowed === null) return;
  if (!stores?.length) throw new ApiError(403, 'Store-level users can only create store-specific coupons');
  if (stores.some((s) => !allowed.includes(String(s)))) throw new ApiError(403, 'No access to one of the selected stores');
}

router.get('/', ah(async (req, res) => {
  const coupons = await Coupon.find({}).populate('stores', 'code').sort('-createdAt').lean();
  const allowed = accessibleStoreIds(req.user);
  res.json(allowed === null ? coupons : coupons.filter((c) => !c.stores.length || c.stores.some((s) => allowed.includes(String(s._id)))));
}));

router.post('/', validate(schema), ah(async (req, res) => {
  checkStores(req.user, req.body.stores);
  const c = await Coupon.create({ ...req.body, createdBy: req.user._id });
  await audit(req, 'coupon.created', 'Coupon', c._id, req.body);
  res.status(201).json(c);
}));

router.put('/:id', validate(schema.partial()), ah(async (req, res) => {
  const c = await Coupon.findById(req.params.id);
  if (!c) throw new ApiError(404, 'Coupon not found');
  checkStores(req.user, c.stores.length ? c.stores : undefined);
  if (req.body.stores) checkStores(req.user, req.body.stores);
  Object.assign(c, req.body);
  await c.save();
  await audit(req, 'coupon.updated', 'Coupon', c._id, req.body);
  res.json(c);
}));

router.get('/:id/redemptions', ah(async (req, res) => {
  res.json(await CouponRedemption.find({ coupon: req.params.id }).populate('user', 'name phone').populate('order', 'orderNumber grandTotal').sort('-createdAt').limit(500).lean());
}));

module.exports = router;
