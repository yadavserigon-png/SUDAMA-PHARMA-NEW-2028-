const express = require('express');
const Expense = require('../models/Expense');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { paginate } = require('../utils/paginate');
const { parseRange } = require('../utils/dates');
const { z } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { storeFilter, assertStoreAccess } = require('../middleware/storeScope');
const { privateDocUpload, checkFiles, fileMeta } = require('../middleware/upload');
const { hasPermission } = require('../config/roles');

const router = express.Router();
router.use(authenticate, requirePermission('expenses.manage', 'expenses.approve'));

router.get('/meta', (req, res) => res.json({ categories: Expense.CATEGORIES }));

router.get('/', ah(async (req, res) => {
  const { page, limit, skip } = paginate(req, { defaultLimit: 50 });
  const filter = storeFilter(req);
  if (req.query.status) filter.status = req.query.status;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.from || req.query.to) {
    const { from, to } = parseRange(req.query);
    filter.date = { $gte: from, $lte: to };
  }
  const [items, total, sums] = await Promise.all([
    Expense.find(filter).populate('store', 'code name').populate('createdBy approvedBy', 'name').sort('-date').skip(skip).limit(limit).lean(),
    Expense.countDocuments(filter),
    Expense.aggregate([{ $match: filter }, { $group: { _id: '$category', amount: { $sum: '$amount' } } }]),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1, byCategory: sums });
}));

const schema = z.object({
  storeId: z.string(),
  date: z.coerce.date(),
  category: z.enum(Expense.CATEGORIES),
  amount: z.coerce.number().positive(),
  vendor: z.string().max(120).optional(),
  paymentMethod: z.enum(['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other']).optional(),
  reference: z.string().max(80).optional(),
  notes: z.string().max(1000).optional(),
});

router.post('/', requirePermission('expenses.manage'), privateDocUpload.single('receipt'), checkFiles, ah(async (req, res) => {
  const b = schema.parse(req.body);
  assertStoreAccess(req.user, b.storeId);
  const e = await Expense.create({ ...b, store: b.storeId, receipt: req.file ? fileMeta(req.file) : undefined, createdBy: req.user._id, status: 'pending' });
  await audit(req, 'expense.created', 'Expense', e._id, { amount: e.amount, category: e.category }, e.store);
  res.status(201).json(e);
}));

router.put('/:id', requirePermission('expenses.manage'), ah(async (req, res) => {
  const e = await Expense.findById(req.params.id);
  if (!e) throw new ApiError(404, 'Expense not found');
  assertStoreAccess(req.user, e.store);
  if (e.status === 'approved' && !hasPermission(req.user, 'expenses.approve')) throw new ApiError(403, 'Approved expenses can only be changed by an approver');
  const b = schema.partial().parse(req.body);
  if (b.storeId) { assertStoreAccess(req.user, b.storeId); e.store = b.storeId; delete b.storeId; }
  Object.assign(e, b);
  if (e.status === 'approved') e.status = 'pending'; // changes need fresh approval
  await e.save();
  await audit(req, 'expense.updated', 'Expense', e._id, b, e.store);
  res.json(e);
}));

router.post('/:id/decision', requirePermission('expenses.approve'), ah(async (req, res) => {
  const { decision } = z.object({ decision: z.enum(['approved', 'rejected']) }).parse(req.body);
  const e = await Expense.findById(req.params.id);
  if (!e) throw new ApiError(404, 'Expense not found');
  assertStoreAccess(req.user, e.store);
  if (String(e.createdBy) === String(req.user._id) && req.user.role !== 'super_admin') throw new ApiError(403, 'You cannot approve your own expense');
  e.status = decision;
  e.approvedBy = req.user._id;
  e.approvedAt = new Date();
  await e.save();
  await audit(req, `expense.${decision}`, 'Expense', e._id, {}, e.store);
  res.json(e);
}));

module.exports = router;
