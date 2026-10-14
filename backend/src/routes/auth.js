const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Store = require('../models/Store');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { z, validate, phone, password, pincode } = require('../utils/validate');
const { signToken, authenticate } = require('../middleware/auth');
const { effectivePermissions, ROLE_LABELS } = require('../config/roles');
const { sendMessage } = require('../services/messaging');

const router = express.Router();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: env.nodeEnv === 'test' ? 1000 : 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Please try again later.' } });

async function sessionPayload(user) {
  const stores = user.role === 'super_admin' || user.allStores
    ? await Store.find({}).select('name code active').sort('code').lean()
    : await Store.find({ _id: { $in: user.stores } }).select('name code active').sort('code').lean();
  return {
    user: user.toSafeJSON(),
    roleLabel: ROLE_LABELS[user.role],
    permissions: effectivePermissions(user),
    stores,
    allStores: user.role === 'super_admin' || user.allStores,
  };
}

function findByIdentifier(identifier) {
  const id = String(identifier || '').trim().toLowerCase();
  const p = id.replace(/^\+?91/, '');
  return User.findOne(/^[6-9]\d{9}$/.test(p) ? { phone: p } : { email: id });
}

// ---------- First-time Super Admin setup ----------
router.get('/setup-status', ah(async (req, res) => {
  const exists = await User.exists({ role: 'super_admin' });
  res.json({ needsSetup: !exists, setupTokenConfigured: Boolean(env.setupToken) });
}));

router.post('/setup', authLimiter, validate(z.object({
  setupToken: z.string().min(1),
  name: z.string().trim().min(2),
  phone,
  email: z.string().email(),
  password,
})), ah(async (req, res) => {
  if (await User.exists({ role: 'super_admin' })) throw new ApiError(409, 'Setup already completed');
  if (!env.setupToken || env.setupToken.length < 12) throw new ApiError(503, 'SETUP_TOKEN (min 12 chars) is not configured on the server');
  const a = Buffer.from(sha(req.body.setupToken));
  const b = Buffer.from(sha(env.setupToken));
  if (!crypto.timingSafeEqual(a, b)) throw new ApiError(403, 'Invalid setup token');
  const user = new User({ name: req.body.name, phone: req.body.phone, email: req.body.email, role: 'super_admin', allStores: true, phoneVerified: false });
  await user.setPassword(req.body.password);
  await user.save();
  req.user = user;
  await audit(req, 'setup.super_admin_created', 'User', user._id);
  res.status(201).json({ token: signToken(user), ...(await sessionPayload(user)) });
}));

// ---------- Customer registration + verification ----------
router.post('/register', authLimiter, validate(z.object({
  name: z.string().trim().min(2).max(120),
  phone,
  email: z.string().email().optional().or(z.literal('')),
  password,
})), ah(async (req, res) => {
  const { name, phone: ph, email, password: pw } = req.body;
  if (await User.exists({ phone: ph })) throw new ApiError(409, 'An account with this mobile number already exists');
  if (email && (await User.exists({ email: email.toLowerCase() }))) throw new ApiError(409, 'An account with this email already exists');
  const user = new User({ name, phone: ph, email: email || undefined, role: 'customer' });
  await user.setPassword(pw);
  const code = String(crypto.randomInt(100000, 999999));
  user.verificationCodeHash = sha(code);
  user.verificationExpires = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();
  const sent = await sendMessage('sms', ph, `Your Sudama Pharma verification code is ${code}. It expires in 10 minutes.`);
  res.status(201).json({
    token: signToken(user),
    ...(await sessionPayload(user)),
    verification: { delivered: sent.delivered, devCode: !env.isProd && !sent.delivered ? code : undefined },
  });
}));

router.post('/verify', authenticate, validate(z.object({ code: z.string().regex(/^\d{6}$/) })), ah(async (req, res) => {
  const user = await User.findById(req.user._id).select('+verificationCodeHash +verificationExpires');
  if (!user.verificationCodeHash || user.verificationExpires < new Date()) throw new ApiError(400, 'Code expired. Request a new one.');
  if (user.verificationCodeHash !== sha(req.body.code)) throw new ApiError(400, 'Incorrect code');
  user.phoneVerified = true;
  user.verificationCodeHash = undefined;
  user.verificationExpires = undefined;
  await user.save();
  res.json({ ok: true });
}));

router.post('/resend-verification', authLimiter, authenticate, ah(async (req, res) => {
  const user = await User.findById(req.user._id);
  const code = String(crypto.randomInt(100000, 999999));
  user.verificationCodeHash = sha(code);
  user.verificationExpires = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();
  const sent = await sendMessage('sms', user.phone, `Your Sudama Pharma verification code is ${code}.`);
  res.json({ delivered: sent.delivered, devCode: !env.isProd && !sent.delivered ? code : undefined });
}));

// ---------- Login with lockout ----------
router.post('/login', authLimiter, validate(z.object({ identifier: z.string().min(3), password: z.string().min(1) })), ah(async (req, res) => {
  const user = await findByIdentifier(req.body.identifier).select('+passwordHash');
  const fail = () => { throw new ApiError(401, 'Incorrect mobile/email or password'); };
  if (!user) fail();
  if (!user.active) throw new ApiError(403, 'This account has been deactivated. Contact the administrator.');
  if (user.lockUntil && user.lockUntil > new Date()) {
    throw new ApiError(429, `Account temporarily locked after failed attempts. Try again after ${user.lockUntil.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}.`);
  }
  if (!(await user.checkPassword(req.body.password))) {
    user.failedLogins = (user.failedLogins || 0) + 1;
    if (user.failedLogins >= MAX_FAILED) {
      user.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      user.failedLogins = 0;
    }
    await user.save();
    fail();
  }
  user.failedLogins = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();
  req.user = user;
  if (user.role !== 'customer') await audit(req, 'auth.login', 'User', user._id);
  res.json({ token: signToken(user), ...(await sessionPayload(user)) });
}));

// ---------- Password recovery ----------
router.post('/forgot-password', authLimiter, validate(z.object({ identifier: z.string().min(3) })), ah(async (req, res) => {
  const user = await findByIdentifier(req.body.identifier);
  let devToken;
  if (user && user.active) {
    const token = crypto.randomBytes(24).toString('hex');
    user.resetTokenHash = sha(token);
    user.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();
    const sent = await sendMessage(user.email ? 'email' : 'sms', user.email || user.phone, `Sudama Pharma password reset code: ${token} (valid 30 minutes)`);
    if (!env.isProd && !sent.delivered) devToken = token;
  }
  // Same response whether or not the account exists (prevents account enumeration)
  res.json({ ok: true, message: 'If the account exists, a reset code has been sent.', devToken });
}));

router.post('/reset-password', authLimiter, validate(z.object({ identifier: z.string().min(3), token: z.string().min(10), password })), ah(async (req, res) => {
  const user = await findByIdentifier(req.body.identifier).select('+resetTokenHash +resetTokenExpires');
  if (!user || !user.resetTokenHash || user.resetTokenExpires < new Date() || user.resetTokenHash !== sha(req.body.token)) {
    throw new ApiError(400, 'Invalid or expired reset code');
  }
  await user.setPassword(req.body.password);
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  user.tokenVersion = (user.tokenVersion || 0) + 1; // log out everywhere
  user.failedLogins = 0;
  user.lockUntil = undefined;
  await user.save();
  req.user = user;
  await audit(req, 'auth.password_reset', 'User', user._id);
  res.json({ ok: true });
}));

// ---------- Session ----------
router.get('/me', authenticate, ah(async (req, res) => res.json(await sessionPayload(req.user))));

router.put('/me', authenticate, validate(z.object({ name: z.string().trim().min(2).max(120).optional(), email: z.string().email().optional() })), ah(async (req, res) => {
  if (req.body.email && req.body.email !== req.user.email) {
    if (await User.exists({ email: req.body.email.toLowerCase(), _id: { $ne: req.user._id } })) throw new ApiError(409, 'Email already in use');
    req.user.email = req.body.email;
    req.user.emailVerified = false;
  }
  if (req.body.name) req.user.name = req.body.name;
  await req.user.save();
  res.json(await sessionPayload(req.user));
}));

router.post('/change-password', authenticate, validate(z.object({ currentPassword: z.string().min(1), newPassword: password })), ah(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await user.checkPassword(req.body.currentPassword))) throw new ApiError(400, 'Current password is incorrect');
  await user.setPassword(req.body.newPassword);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await audit(req, 'auth.password_changed', 'User', user._id);
  res.json({ token: signToken(user) });
}));

router.post('/logout-all', authenticate, ah(async (req, res) => {
  req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
  await req.user.save();
  res.json({ ok: true });
}));

// ---------- Saved addresses ----------
const addressSchema = z.object({
  label: z.string().max(30).optional(),
  name: z.string().max(120).optional(),
  phone: phone.optional(),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().max(200).optional(),
  landmark: z.string().max(120).optional(),
  city: z.string().trim().min(2).max(80),
  district: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  pincode,
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  isDefault: z.boolean().optional(),
});

router.get('/me/addresses', authenticate, (req, res) => res.json(req.user.addresses));
router.post('/me/addresses', authenticate, validate(addressSchema), ah(async (req, res) => {
  if (req.user.addresses.length >= 10) throw new ApiError(400, 'Maximum 10 saved addresses');
  if (req.body.isDefault || req.user.addresses.length === 0) {
    req.user.addresses.forEach((a) => { a.isDefault = false; });
    req.body.isDefault = true;
  }
  req.user.addresses.push(req.body);
  await req.user.save();
  res.status(201).json(req.user.addresses);
}));
router.put('/me/addresses/:id', authenticate, validate(addressSchema.partial()), ah(async (req, res) => {
  const a = req.user.addresses.id(req.params.id);
  if (!a) throw new ApiError(404, 'Address not found');
  if (req.body.isDefault) req.user.addresses.forEach((x) => { x.isDefault = false; });
  Object.assign(a, req.body);
  await req.user.save();
  res.json(req.user.addresses);
}));
router.delete('/me/addresses/:id', authenticate, ah(async (req, res) => {
  const a = req.user.addresses.id(req.params.id);
  if (!a) throw new ApiError(404, 'Address not found');
  a.deleteOne();
  await req.user.save();
  res.json(req.user.addresses);
}));

module.exports = router;
