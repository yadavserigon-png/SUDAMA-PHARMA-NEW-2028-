const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { hasPermission, isStaff } = require('../config/roles');

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role, tv: user.tokenVersion || 0 }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

async function loadUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new ApiError(401, 'Session expired. Please log in again.');
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.active) throw new ApiError(401, 'Account not found or deactivated');
  // tokenVersion changes on password change / "log out all devices" -> old sessions are rejected
  if ((payload.tv || 0) !== (user.tokenVersion || 0)) throw new ApiError(401, 'Session has been revoked. Please log in again.');
  return user;
}

const authenticate = async (req, res, next) => {
  try {
    const user = await loadUser(req);
    if (!user) return next(new ApiError(401, 'Please log in'));
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    req.user = (await loadUser(req)) || undefined;
  } catch {
    req.user = undefined;
  }
  next();
};

/** Require ANY of the listed permissions. */
const requirePermission = (...perms) => (req, res, next) => {
  if (!req.user) return next(new ApiError(401, 'Please log in'));
  if (perms.some((p) => hasPermission(req.user, p))) return next();
  next(new ApiError(403, 'You do not have permission for this action'));
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new ApiError(401, 'Please log in'));
  if (roles.includes(req.user.role)) return next();
  next(new ApiError(403, 'You do not have permission for this action'));
};

const requireStaff = (req, res, next) => {
  if (!req.user) return next(new ApiError(401, 'Please log in'));
  if (isStaff(req.user.role)) return next();
  next(new ApiError(403, 'Staff access only'));
};

module.exports = { signToken, authenticate, optionalAuth, requirePermission, requireRole, requireStaff };
