const express = require('express');
const ah = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { audit } = require('../utils/audit');
const { authenticate, requirePermission } = require('../middleware/auth');
const { DEFAULTS, getSetting, setSetting } = require('../services/settings');
const { publicImageUpload, checkFiles } = require('../middleware/upload');
const env = require('../config/env');

const router = express.Router();

// Public (branding, policies, payment availability) - safe subset only
router.get('/public', ah(async (req, res) => {
  const [branding, policies, payments] = await Promise.all([getSetting('branding'), getSetting('policies'), getSetting('payments')]);
  res.json({
    branding,
    policies,
    payments: {
      codEnabled: payments.codEnabled,
      codMaxAmount: payments.codMaxAmount,
      phonepeEnabled: payments.phonepeEnabled && env.phonepe.configured,
      upiId: payments.upiVerified ? payments.upiId : '',
      upiPayeeName: payments.upiPayeeName,
      qrImage: payments.upiVerified ? payments.qrImage : '',
    },
    whatsapp: { apiConfigured: env.whatsapp.configured, clickToChat: `https://wa.me/${env.whatsapp.businessNumber}` },
  });
}));

router.use(authenticate);

const PERMS = { branding: 'settings.manage', policies: 'settings.manage', payments: 'payments.config', inventory: 'settings.manage' };

const keyPermission = (req, res, next) => {
  const perm = PERMS[req.params.key];
  if (!perm) return next(new ApiError(404, 'Unknown setting'));
  return requirePermission(perm)(req, res, next);
};

router.get('/:key', keyPermission, ah(async (req, res) => {
  const value = await getSetting(req.params.key);
  const extra = req.params.key === 'payments'
    ? { gateway: { phonepeConfigured: env.phonepe.configured, phonepeEnv: env.phonepe.env, apiVersion: env.phonepe.apiVersion } }
    : {};
  res.json({ value, ...extra });
}));

router.put('/:key', keyPermission, ah(async (req, res) => {
  const allowed = Object.keys(DEFAULTS[req.params.key].value);
  const body = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  // Secrets (gateway keys) are NEVER stored here - they live only in server environment variables.
  const value = await setSetting(req.params.key, body, req.user._id);
  await audit(req, `settings.${req.params.key}.updated`, 'Setting', req.params.key, { fields: Object.keys(body) });
  res.json({ value });
}));

router.post('/upload/image', requirePermission('settings.manage', 'payments.config', 'products.manage', 'ads.manage', 'ads.self', 'stores.manage'), publicImageUpload.single('file'), checkFiles, (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded');
  res.status(201).json({ url: `/uploads/public/${req.file.filename}` });
});

module.exports = router;
