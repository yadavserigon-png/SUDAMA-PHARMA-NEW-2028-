// Attendance, leave, task assignment and employee performance.
const express = require('express');
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const Task = require('../models/Task');
const Order = require('../models/Order');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { parseRange } = require('../utils/dates');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, requirePermission, requireStaff } = require('../middleware/auth');
const { storeFilter, assertStoreAccess, canAccessStore } = require('../middleware/storeScope');
const { hasPermission } = require('../config/roles');
const { dayKey } = require('../services/stockRules');

const router = express.Router();
router.use(authenticate, requireStaff);

async function assertManagesUser(req, userId) {
  const u = await User.findById(userId).lean();
  if (!u) throw new ApiError(404, 'Employee not found');
  if (req.user.role !== 'super_admin' && !(u.stores || []).some((s) => canAccessStore(req.user, s))) throw new ApiError(403, 'No access to this employee');
  return u;
}

// ---------- Attendance ----------
router.post('/attendance/check-in', validate(z.object({ storeId: objectId })), ah(async (req, res) => {
  assertStoreAccess(req.user, req.body.storeId);
  const date = dayKey(new Date());
  const existing = await Attendance.findOne({ user: req.user._id, date });
  if (existing?.checkIn) throw new ApiError(400, 'Already checked in today');
  const a = await Attendance.findOneAndUpdate({ user: req.user._id, date }, { $set: { store: req.body.storeId, checkIn: new Date(), status: 'present' } }, { upsert: true, new: true });
  res.json(a);
}));

router.post('/attendance/check-out', ah(async (req, res) => {
  const a = await Attendance.findOne({ user: req.user._id, date: dayKey(new Date()) });
  if (!a?.checkIn) throw new ApiError(400, 'Check in first');
  if (a.checkOut) throw new ApiError(400, 'Already checked out');
  a.checkOut = new Date();
  await a.save();
  res.json(a);
}));

router.post('/attendance', requirePermission('employees.manage'), validate(z.object({ userId: objectId, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), status: z.enum(['present', 'absent', 'half_day', 'leave', 'holiday']), note: z.string().max(200).optional() })), ah(async (req, res) => {
  const u = await assertManagesUser(req, req.body.userId);
  const a = await Attendance.findOneAndUpdate({ user: u._id, date: req.body.date }, { $set: { status: req.body.status, note: req.body.note, markedBy: req.user._id, store: u.stores?.[0] } }, { upsert: true, new: true });
  await audit(req, 'attendance.marked', 'User', u._id, req.body);
  res.json(a);
}));

router.get('/attendance', ah(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const filter = { date: { $gte: dayKey(from), $lte: dayKey(to) } };
  if (hasPermission(req.user, 'employees.view') && req.query.mine !== 'true') {
    Object.assign(filter, storeFilter(req));
    if (req.query.userId && mongoose.isValidObjectId(req.query.userId)) filter.user = new mongoose.Types.ObjectId(req.query.userId);
  } else filter.user = req.user._id;
  res.json(await Attendance.find(filter).populate('user', 'name employee.employeeId role').sort({ date: -1 }).limit(2000).lean());
}));

// ---------- Leave ----------
router.post('/leaves', validate(z.object({ from: z.coerce.date(), to: z.coerce.date(), type: z.enum(['casual', 'sick', 'earned', 'unpaid', 'other']), reason: z.string().max(500).optional() })), ah(async (req, res) => {
  if (req.body.to < req.body.from) throw new ApiError(400, 'End date must be after start date');
  res.status(201).json(await Leave.create({ ...req.body, user: req.user._id, store: req.user.stores?.[0] }));
}));

router.get('/leaves', ah(async (req, res) => {
  const filter = hasPermission(req.user, 'employees.view') && req.query.mine !== 'true' ? storeFilter(req) : { user: req.user._id };
  if (req.query.status) filter.status = req.query.status;
  res.json(await Leave.find(filter).populate('user', 'name role').populate('decidedBy', 'name').sort('-createdAt').limit(300).lean());
}));

router.post('/leaves/:id/decision', requirePermission('employees.manage'), validate(z.object({ status: z.enum(['approved', 'rejected']) })), ah(async (req, res) => {
  const l = await Leave.findById(req.params.id);
  if (!l) throw new ApiError(404, 'Leave not found');
  await assertManagesUser(req, l.user);
  if (String(l.user) === String(req.user._id)) throw new ApiError(403, 'You cannot approve your own leave');
  l.status = req.body.status;
  l.decidedBy = req.user._id;
  await l.save();
  await audit(req, `leave.${req.body.status}`, 'Leave', l._id);
  res.json(l);
}));

// ---------- Tasks ----------
router.get('/tasks', ah(async (req, res) => {
  const filter = req.query.mine === 'true' || !hasPermission(req.user, 'employees.view') ? { assignedTo: req.user._id } : storeFilter(req);
  if (req.query.status) filter.status = req.query.status;
  res.json(await Task.find(filter).populate('assignedTo assignedBy', 'name').populate('store', 'code').sort({ status: 1, dueAt: 1 }).limit(300).lean());
}));

router.post('/tasks', requirePermission('employees.manage'), validate(z.object({ title: z.string().trim().min(3).max(150), description: z.string().max(2000).optional(), storeId: objectId, assignedTo: objectId, dueAt: z.coerce.date().optional(), priority: z.enum(['low', 'medium', 'high']).optional() })), ah(async (req, res) => {
  assertStoreAccess(req.user, req.body.storeId);
  await assertManagesUser(req, req.body.assignedTo);
  const t = await Task.create({ ...req.body, store: req.body.storeId, assignedBy: req.user._id });
  res.status(201).json(t);
}));

router.put('/tasks/:id', validate(z.object({ status: z.enum(['todo', 'in_progress', 'done', 'cancelled']) })), ah(async (req, res) => {
  const t = await Task.findById(req.params.id);
  if (!t) throw new ApiError(404, 'Task not found');
  const mine = String(t.assignedTo) === String(req.user._id);
  if (!mine && !(hasPermission(req.user, 'employees.manage') && canAccessStore(req.user, t.store))) throw new ApiError(403, 'No access');
  t.status = req.body.status;
  if (t.status === 'done') t.completedAt = new Date();
  await t.save();
  res.json(t);
}));

// ---------- Performance ----------
router.get('/performance', requirePermission('employees.view', 'reports.view'), ah(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const sf = storeFilter(req);
  const [sales, attendance, tasks] = await Promise.all([
    Order.aggregate([
      { $match: { ...sf, cashier: { $ne: null }, completedAt: { $gte: from, $lte: to }, status: { $in: ['completed', 'delivered', 'partially_returned', 'returned'] } } },
      { $group: { _id: '$cashier', bills: { $sum: 1 }, sales: { $sum: '$grandTotal' }, discounts: { $sum: { $add: ['$productDiscount', '$couponDiscount'] } }, overrides: { $sum: { $size: { $filter: { input: '$items', cond: { $ifNull: ['$$this.priceOverride.by', false] } } } } } } },
    ]),
    Attendance.aggregate([{ $match: { ...sf, date: { $gte: dayKey(from), $lte: dayKey(to) } } }, { $group: { _id: '$user', present: { $sum: { $cond: [{ $in: ['$status', ['present', 'half_day']] }, 1, 0] } }, absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } } } }]),
    Task.aggregate([{ $match: { ...sf, createdAt: { $gte: from, $lte: to } } }, { $group: { _id: '$assignedTo', total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } } } }]),
  ]);
  const ids = [...new Set([...sales, ...attendance, ...tasks].map((x) => String(x._id)))];
  const users = await User.find({ _id: { $in: ids } }).select('name role employee.employeeId').lean();
  const pick = (arr, id) => arr.find((x) => String(x._id) === id) || {};
  res.json(users.map((u) => {
    const id = String(u._id);
    const s = pick(sales, id);
    return { user: u, bills: s.bills || 0, sales: Math.round((s.sales || 0) * 100) / 100, averageBill: s.bills ? Math.round((s.sales / s.bills) * 100) / 100 : 0, discounts: s.discounts || 0, priceOverrides: s.overrides || 0, attendance: pick(attendance, id), tasks: pick(tasks, id) };
  }).sort((a, b) => b.sales - a.sales));
}));

module.exports = router;
