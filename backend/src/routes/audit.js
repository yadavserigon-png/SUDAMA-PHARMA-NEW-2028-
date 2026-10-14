const express = require('express');
const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const ah = require('../utils/asyncHandler');
const { paginate, escapeRegex } = require('../utils/paginate');
const { parseRange } = require('../utils/dates');
const { authenticate, requirePermission } = require('../middleware/auth');
const { accessibleStoreIds, toId } = require('../middleware/storeScope');

const router = express.Router();
router.use(authenticate, requirePermission('audit.view'));

router.get('/', ah(async (req, res) => {
  const { page, limit, skip } = paginate(req, { defaultLimit: 50 });
  const filter = {};
  const allowed = accessibleStoreIds(req.user);
  if (allowed !== null) filter.store = { $in: allowed.map(toId) };
  if (req.query.storeId && req.query.storeId !== 'all' && mongoose.isValidObjectId(req.query.storeId)) filter.store = toId(req.query.storeId);
  if (req.query.action) filter.action = new RegExp(`^${escapeRegex(req.query.action)}`);
  if (req.query.user && mongoose.isValidObjectId(req.query.user)) filter.user = toId(req.query.user);
  if (req.query.entityId) filter.entityId = String(req.query.entityId);
  if (req.query.from || req.query.to) {
    const { from, to } = parseRange(req.query);
    filter.createdAt = { $gte: from, $lte: to };
  }
  const [items, total] = await Promise.all([AuditLog.find(filter).sort('-createdAt').skip(skip).limit(limit).lean(), AuditLog.countDocuments(filter)]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

module.exports = router;
