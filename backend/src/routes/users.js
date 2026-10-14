// Administrators, employees, delivery partners, customers and wholesale buyers.
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Store = require('../models/Store');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { paginate, escapeRegex } = require('../utils/paginate');
const { z, validate, phone, password } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { accessibleStoreIds } = require('../middleware/storeScope');
const { ROLES, ROLE_LABELS, PERMISSIONS, ROLE_PERMISSIONS, canAssignRole, hasPermission, isStaff, ADMIN_ROLES } = require('../config/roles');

const router = express.Router();
router.use(authenticate);

const STAFF_VIEW = ['users.manage', 'employees.view', 'employees.manage', 'delivery.manage', 'customers.manage', 'wholesale.manage'];

/** Can the actor manage this target user? (enforced on every write) */
function canManage(actor, target) {
  if (actor.role === 'super_admin') return true;
  if (target.role === 'super_admin' || ADMIN_ROLES.includes(target.role)) return false; // only owner manages admins
  if (String(actor._id) === String(target._id)) return false; // no self role/permission edits
  if (['customer', 'wholesale_buyer', 'advertiser'].includes(target.role)) {
    return hasPermission(actor, 'customers.manage') || hasPermission(actor, 'wholesale.manage') || hasPermission(actor, 'users.manage');
  }
  const allowed = accessibleStoreIds(actor);
  if (allowed === null) return true;
  return (target.stores || []).some((s) => allowed.includes(String(s)));
}

function assertStoresAllowed(actor, stores = [], allStores) {
  if (allStores && actor.role !== 'super_admin') throw new ApiError(403, 'Only the Super Admin can grant all-store access');
  const allowed = accessibleStoreIds(actor);
  if (allowed === null) return;
  for (const s of stores) if (!allowed.includes(String(s))) throw new ApiError(403, 'You can only assign stores you manage');
}

function shape(user, actor) {
  const o = user.toSafeJSON ? user.toSafeJSON() : user;
  if (hasPermission(actor, 'salary.view') && user.employee?.salary != null) o.employee = { ...o.employee, salary: user.employee.salary };
  o.roleLabel = ROLE_LABELS[o.role];
  return o;
}

router.get('/meta/roles', requirePermission(...STAFF_VIEW), (req, res) => {
  res.json({
    roles: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r], assignable: canAssignRole(req.user, r), permissions: ROLE_PERMISSIONS[r] })),
    permissions: PERMISSIONS,
  });
});

router.get('/', requirePermission(...STAFF_VIEW), ah(async (req, res) => {
  const { page, limit, skip } = paginate(req);
  const filter = {};
  const role = req.query.role;
  if (role && role !== 'staff') filter.role = { $in: String(role).split(',') };
  if (role === 'staff') filter.role = { $in: ROLES.filter(isStaff) };
  if (req.query.active === 'true') filter.active = true;
  if (req.query.active === 'false') filter.active = false;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }, { 'employee.employeeId': rx }, { 'wholesale.businessName': rx }];
  }
  const customerRoles = ['customer', 'wholesale_buyer', 'advertiser'];
  const wantsOnlyCustomers = filter.role && filter.role.$in.every((r) => customerRoles.includes(r));
  if (wantsOnlyCustomers) {
    if (!hasPermission(req.user, 'customers.manage') && !hasPermission(req.user, 'wholesale.manage') && !hasPermission(req.user, 'users.manage')) {
      throw new ApiError(403, 'You do not have permission to view customers');
    }
  } else {
    // staff lists are store-scoped at the query level
    const allowed = accessibleStoreIds(req.user);
    const requested = req.query.storeId && req.query.storeId !== 'all' ? [String(req.query.storeId)] : null;
    if (requested && allowed !== null && !allowed.includes(requested[0])) throw new ApiError(403, 'No access to this store');
    if (requested) filter.stores = new mongoose.Types.ObjectId(requested[0]);
    else if (allowed !== null) {
      filter.stores = { $in: allowed.map((s) => new mongoose.Types.ObjectId(s)) };
      if (!filter.role) filter.role = { $nin: customerRoles };
    }
  }
  const q = User.find(filter).populate('stores', 'name code').sort('-createdAt');
  if (hasPermission(req.user, 'salary.view')) q.select('+employee.salary');
  const [items, total] = await Promise.all([q.skip(skip).limit(limit), User.countDocuments(filter)]);
  res.json({ items: items.map((u) => shape(u, req.user)), total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

router.get('/:id', requirePermission(...STAFF_VIEW), ah(async (req, res) => {
  const q = User.findById(req.params.id).populate('stores', 'name code');
  if (hasPermission(req.user, 'salary.view')) q.select('+employee.salary');
  const user = await q;
  if (!user) throw new ApiError(404, 'User not found');
  if (!canManage(req.user, user) && String(user._id) !== String(req.user._id)) throw new ApiError(403, 'No access to this user');
  res.json(shape(user, req.user));
}));

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone,
  email: z.string().email().optional().or(z.literal('')),
  password, // temporary password chosen by the admin; user should change it after first login
  role: z.enum(ROLES),
  stores: z.array(z.string()).optional(),
  allStores: z.boolean().optional(),
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
  deniedPermissions: z.array(z.enum(PERMISSIONS)).optional(),
  employee: z.object({
    employeeId: z.string().trim().max(30).optional(),
    designation: z.string().max(80).optional(),
    joiningDate: z.coerce.date().optional(),
    status: z.enum(['active', 'on_leave', 'resigned', 'terminated']).optional(),
    shift: z.object({ name: z.string().optional(), start: z.string().optional(), end: z.string().optional() }).optional(),
  }).optional(),
  deliveryProfile: z.object({ vehicleType: z.string().optional(), vehicleNumber: z.string().optional(), licenseNumber: z.string().optional(), zones: z.array(z.string()).optional(), ratePerDelivery: z.number().min(0).optional() }).optional(),
  wholesale: z.object({ businessName: z.string().optional(), gstin: z.string().optional(), drugLicenseNo: z.string().optional(), drugLicenseValidTill: z.coerce.date().optional(), priceTier: z.string().optional(), creditLimit: z.number().min(0).optional() }).optional(),
});

router.post('/', requirePermission('users.manage', 'employees.manage', 'delivery.manage', 'admins.manage', 'customers.manage', 'wholesale.manage'), validate(createSchema), ah(async (req, res) => {
  const b = req.body;
  if (!canAssignRole(req.user, b.role)) throw new ApiError(403, `You cannot create a ${ROLE_LABELS[b.role]}`);
  if ((b.permissions?.length || b.deniedPermissions?.length) && req.user.role !== 'super_admin') throw new ApiError(403, 'Only the Super Admin can configure individual permissions');
  assertStoresAllowed(req.user, b.stores, b.allStores);
  if (b.stores?.length) {
    const n = await Store.countDocuments({ _id: { $in: b.stores } });
    if (n !== b.stores.length) throw new ApiError(400, 'One or more stores not found');
  }
  if (isStaff(b.role) && b.role !== 'super_admin' && !b.allStores && !(b.stores || []).length) throw new ApiError(400, 'Assign at least one store to staff members');
  if (await User.exists({ phone: b.phone })) throw new ApiError(409, 'Mobile number already registered');
  const user = new User({ ...b, email: b.email || undefined, phoneVerified: true });
  await user.setPassword(b.password);
  if (b.role === 'delivery_partner') user.deliveryProfile = { ...(b.deliveryProfile || {}), approved: false };
  await user.save();
  await audit(req, 'user.created', 'User', user._id, { role: user.role, stores: b.stores });
  res.status(201).json(shape(user, req.user));
}));

const updateSchema = createSchema.omit({ password: true }).partial().extend({ active: z.boolean().optional() });

router.put('/:id', requirePermission('users.manage', 'employees.manage', 'delivery.manage', 'admins.manage', 'customers.manage', 'wholesale.manage'), validate(updateSchema), ah(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  if (!canManage(req.user, user)) throw new ApiError(403, 'You cannot modify this user');
  const b = req.body;
  if (b.role && b.role !== user.role && !canAssignRole(req.user, b.role)) throw new ApiError(403, 'You cannot assign this role');
  if (user.role === 'super_admin' && (b.role && b.role !== 'super_admin' || b.active === false)) {
    const others = await User.countDocuments({ role: 'super_admin', active: true, _id: { $ne: user._id } });
    if (!others) throw new ApiError(400, 'At least one active Super Admin is required');
  }
  if ((b.permissions || b.deniedPermissions) && req.user.role !== 'super_admin') throw new ApiError(403, 'Only the Super Admin can configure individual permissions');
  if (b.stores || b.allStores !== undefined) assertStoresAllowed(req.user, b.stores || [], b.allStores);
  if (b.phone && b.phone !== user.phone && (await User.exists({ phone: b.phone }))) throw new ApiError(409, 'Mobile number already registered');

  const before = { role: user.role, active: user.active, stores: user.stores.map(String) };
  for (const k of ['name', 'phone', 'role', 'stores', 'allStores', 'permissions', 'deniedPermissions', 'active']) if (b[k] !== undefined) user[k] = b[k];
  if (b.email !== undefined) user.email = b.email || undefined;
  if (b.employee) user.employee = { ...(user.employee?.toObject?.() || {}), ...b.employee };
  if (b.deliveryProfile) Object.assign(user.deliveryProfile, b.deliveryProfile);
  if (b.wholesale) Object.assign(user.wholesale, b.wholesale);
  if (b.active === false || (b.role && b.role !== before.role) || b.stores || b.permissions || b.deniedPermissions) {
    user.tokenVersion = (user.tokenVersion || 0) + 1; // force re-login with new access
  }
  if (b.active === false && user.deliveryProfile) user.deliveryProfile.online = false;
  await user.save();
  await audit(req, b.active === false ? 'user.deactivated' : 'user.updated', 'User', user._id, { before, fields: Object.keys(b) });
  res.json(shape(user, req.user));
}));

router.put('/:id/salary', requirePermission('salary.view'), validate(z.object({ salary: z.number().min(0), bankNote: z.string().max(200).optional() })), ah(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  if (!canManage(req.user, user)) throw new ApiError(403, 'You cannot modify this user');
  await User.updateOne({ _id: user._id }, { $set: { 'employee.salary': req.body.salary, 'employee.bankNote': req.body.bankNote } });
  await audit(req, 'employee.salary_updated', 'User', user._id);
  res.json({ ok: true });
}));

router.post('/:id/reset-password', requirePermission('users.manage', 'employees.manage', 'admins.manage', 'delivery.manage'), validate(z.object({ password })), ah(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  if (!canManage(req.user, user)) throw new ApiError(403, 'You cannot modify this user');
  await user.setPassword(req.body.password);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.failedLogins = 0;
  user.lockUntil = undefined;
  await user.save();
  await audit(req, 'user.password_reset_by_admin', 'User', user._id);
  res.json({ ok: true });
}));

// Delivery partner approval / document verification
router.put('/:id/delivery', requirePermission('delivery.manage'), validate(z.object({
  approved: z.boolean().optional(), zones: z.array(z.string()).optional(), ratePerDelivery: z.number().min(0).optional(),
  verifyDocumentId: z.string().optional(),
})), ah(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || user.role !== 'delivery_partner') throw new ApiError(404, 'Delivery partner not found');
  if (!canManage(req.user, user)) throw new ApiError(403, 'You cannot modify this partner');
  const b = req.body;
  if (b.approved !== undefined) user.deliveryProfile.approved = b.approved;
  if (b.zones) user.deliveryProfile.zones = b.zones;
  if (b.ratePerDelivery !== undefined) user.deliveryProfile.ratePerDelivery = b.ratePerDelivery;
  if (b.verifyDocumentId) {
    const d = user.deliveryProfile.documents.id(b.verifyDocumentId);
    if (d) d.verified = true;
  }
  if (b.approved === false) user.deliveryProfile.online = false;
  await user.save();
  await audit(req, 'delivery_partner.updated', 'User', user._id, b);
  res.json(shape(user, req.user));
}));

// Wholesale buyer verification (licence + GST checked by staff)
router.put('/:id/wholesale', requirePermission('wholesale.manage'), validate(z.object({
  verified: z.boolean().optional(), priceTier: z.string().optional(), creditLimit: z.number().min(0).optional(), verifyDocumentId: z.string().optional(),
})), ah(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || user.role !== 'wholesale_buyer') throw new ApiError(404, 'Wholesale buyer not found');
  const b = req.body;
  if (b.verified === true && (!user.wholesale.drugLicenseNo || !user.wholesale.gstin)) {
    throw new ApiError(400, 'Drug licence number and GSTIN are required before verification');
  }
  if (b.verified !== undefined) {
    user.wholesale.verified = b.verified;
    user.wholesale.verifiedBy = req.user._id;
  }
  if (b.priceTier !== undefined) user.wholesale.priceTier = b.priceTier;
  if (b.creditLimit !== undefined) user.wholesale.creditLimit = b.creditLimit;
  if (b.verifyDocumentId) {
    const d = user.wholesale.documents.id(b.verifyDocumentId);
    if (d) d.verified = true;
  }
  await user.save();
  await audit(req, 'wholesale_buyer.updated', 'User', user._id, b);
  res.json(shape(user, req.user));
}));

module.exports = router;
