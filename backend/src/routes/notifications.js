const express = require('express');
const Notification = require('../models/Notification');
const ah = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { accessibleStoreIds, toId } = require('../middleware/storeScope');
const { isStaff } = require('../config/roles');

const router = express.Router();
router.use(authenticate);

function filterFor(user) {
  const or = [{ user: user._id }];
  if (isStaff(user.role)) {
    const allowed = accessibleStoreIds(user);
    or.push(allowed === null ? { audience: 'store_staff' } : { audience: 'store_staff', store: { $in: allowed.map(toId) } });
  }
  return { $or: or };
}

router.get('/', ah(async (req, res) => {
  const f = filterFor(req.user);
  const [items, unread] = await Promise.all([
    Notification.find(f).sort('-createdAt').limit(50).lean(),
    Notification.countDocuments({ ...f, read: false }),
  ]);
  res.json({ items, unread });
}));

router.post('/:id/read', ah(async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, ...filterFor(req.user) }, { read: true });
  res.json({ ok: true });
}));

router.post('/read-all', ah(async (req, res) => {
  await Notification.updateMany({ ...filterFor(req.user), read: false }, { read: true });
  res.json({ ok: true });
}));

module.exports = router;
