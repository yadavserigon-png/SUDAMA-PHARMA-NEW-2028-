const express = require('express');
const Store = require('../models/Store');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { z, validate, pincode } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { accessibleStoreIds, assertStoreAccess } = require('../middleware/storeScope');
const { storeServes } = require('../services/geo');

const router = express.Router();

const PUBLIC_FIELDS = 'code name type logo address location deliveryRadiusKm serviceablePincodes deliveryFee freeDeliveryAbove openingHours holidays contact acceptsOnlineOrders license.retailDrugLicenseNo license.pharmacistName';

// Public: store locator + selector
router.get('/public', ah(async (req, res) => {
  res.json(await Store.find({ active: true }).select(PUBLIC_FIELDS).sort('code').lean());
}));

// Public: which stores can deliver to this PIN / location
router.get('/serviceability', ah(async (req, res) => {
  const pin = String(req.query.pincode || '');
  const lat = req.query.lat ? Number(req.query.lat) : undefined;
  const lng = req.query.lng ? Number(req.query.lng) : undefined;
  if (!/^\d{6}$/.test(pin) && (lat == null || lng == null)) throw new ApiError(400, 'Provide a 6-digit PIN code or location');
  const stores = await Store.find({ active: true }).lean();
  const result = stores
    .map((s) => ({ store: { _id: s._id, name: s.name, code: s.code, address: s.address, location: s.location, deliveryFee: s.deliveryFee, freeDeliveryAbove: s.freeDeliveryAbove }, ...storeServes(s, { pincode: pin, lat, lng }) }))
    .filter((r) => r.ok)
    .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  res.json({ serviceable: result.length > 0, stores: result });
}));

const storeSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/),
  name: z.string().trim().min(2),
  type: z.enum(['retail', 'wholesale', 'retail_wholesale', 'warehouse']).optional(),
  logo: z.string().optional(),
  address: z.object({ line1: z.string().min(2), line2: z.string().optional(), city: z.string().min(2), district: z.string().min(2), state: z.string().optional(), pincode }),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  deliveryRadiusKm: z.number().min(0).max(100).optional(),
  serviceablePincodes: z.array(z.string().regex(/^\d{6}$/)).optional(),
  deliveryZones: z.array(z.object({ name: z.string(), pincodes: z.array(z.string()), fee: z.number().min(0).optional() })).optional(),
  deliveryFee: z.number().min(0).optional(),
  freeDeliveryAbove: z.number().min(0).optional(),
  openingHours: z.array(z.object({ day: z.number().int().min(0).max(6), open: z.string().optional(), close: z.string().optional(), closed: z.boolean().optional() })).optional(),
  holidays: z.array(z.object({ date: z.coerce.date(), note: z.string().optional() })).optional(),
  contact: z.object({ phone: z.string().optional(), email: z.string().optional(), whatsapp: z.string().optional() }).optional(),
  license: z.object({
    retailDrugLicenseNo: z.string().optional(), wholesaleDrugLicenseNo: z.string().optional(), gstin: z.string().optional(), fssaiNo: z.string().optional(),
    pharmacistName: z.string().optional(), pharmacistRegNo: z.string().optional(), validTill: z.coerce.date().optional(),
  }).optional(),
  manager: z.string().optional().nullable(),
  acceptsOnlineOrders: z.boolean().optional(),
  active: z.boolean().optional(),
});

router.use(authenticate);

router.get('/', requirePermission('stores.view', 'stores.manage'), ah(async (req, res) => {
  const allowed = accessibleStoreIds(req.user);
  const filter = allowed === null ? {} : { _id: { $in: allowed } };
  const stores = await Store.find(filter).populate('manager', 'name phone').sort('code').lean();
  const staffCounts = await User.aggregate([{ $match: { stores: { $in: stores.map((s) => s._id) }, active: true } }, { $unwind: '$stores' }, { $group: { _id: { store: '$stores', role: '$role' }, n: { $sum: 1 } } }]);
  for (const s of stores) {
    s.staff = staffCounts.filter((c) => String(c._id.store) === String(s._id)).reduce((o, c) => ({ ...o, [c._id.role]: c.n }), {});
  }
  res.json(stores);
}));

router.get('/:id', requirePermission('stores.view', 'stores.manage'), ah(async (req, res) => {
  assertStoreAccess(req.user, req.params.id);
  const store = await Store.findById(req.params.id).populate('manager', 'name phone email').lean();
  if (!store) throw new ApiError(404, 'Store not found');
  store.employees = await User.find({ stores: store._id }).select('name phone role active employee.employeeId deliveryProfile.online').lean();
  res.json(store);
}));

async function assignManager(storeId, managerId) {
  if (!managerId) return;
  const m = await User.findById(managerId);
  if (!m) throw new ApiError(400, 'Manager not found');
  if (!m.stores.map(String).includes(String(storeId))) {
    m.stores.push(storeId);
    await m.save();
  }
}

router.post('/', requirePermission('stores.manage'), validate(storeSchema), ah(async (req, res) => {
  if (!(req.user.role === 'super_admin' || req.user.allStores)) throw new ApiError(403, 'Only central administrators can create stores');
  const store = await Store.create(req.body);
  await assignManager(store._id, req.body.manager);
  await audit(req, 'store.created', 'Store', store._id, { code: store.code }, store._id);
  res.status(201).json(store);
}));

router.put('/:id', requirePermission('stores.manage'), validate(storeSchema.partial()), ah(async (req, res) => {
  assertStoreAccess(req.user, req.params.id);
  const store = await Store.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!store) throw new ApiError(404, 'Store not found');
  await assignManager(store._id, req.body.manager);
  await audit(req, 'store.updated', 'Store', store._id, { fields: Object.keys(req.body) }, store._id);
  res.json(store);
}));

module.exports = router;
