const AuditLog = require('../models/AuditLog');

/** Record an important action. Never throws (audit failure must not break the request). */
async function audit(req, action, entity, entityId, meta = {}, store) {
  try {
    await AuditLog.create({
      user: req.user?._id,
      userName: req.user?.name,
      role: req.user?.role,
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      store,
      meta,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  } catch (e) {
    console.error('[audit] failed', e.message);
  }
}

module.exports = { audit };
