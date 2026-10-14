// Store-level access control. Applied in every store-bound query so a user can never
// read or write data of a store they are not assigned to (enforced on the server).
const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');

const toId = (v) => new mongoose.Types.ObjectId(String(v));

/** null => all stores; otherwise array of store id strings */
function accessibleStoreIds(user) {
  if (!user) return [];
  if (user.role === 'super_admin' || user.allStores) return null;
  return (user.stores || []).map(String);
}

function canAccessStore(user, storeId) {
  const allowed = accessibleStoreIds(user);
  return allowed === null || allowed.includes(String(storeId));
}

function assertStoreAccess(user, storeId) {
  if (!storeId || !mongoose.isValidObjectId(storeId)) throw new ApiError(400, 'A valid store is required');
  if (!canAccessStore(user, storeId)) throw new ApiError(403, 'You do not have access to this store');
}

/**
 * Build a Mongo filter for the requested store (query.storeId or "all").
 * Returned ids are ObjectIds so the filter is safe for aggregate() as well as find().
 */
function storeFilter(req, field = 'store') {
  const requested = req.query.storeId || req.body?.storeId;
  const allowed = accessibleStoreIds(req.user);
  if (!requested || requested === 'all') {
    if (allowed === null) return {};
    return { [field]: { $in: allowed.map(toId) } };
  }
  assertStoreAccess(req.user, requested);
  return { [field]: toId(requested) };
}

module.exports = { accessibleStoreIds, canAccessStore, assertStoreAccess, storeFilter, toId };
