const mongoose = require('mongoose');

const { Schema } = mongoose;

const auditSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    userName: String,
    role: String,
    action: { type: String, required: true, index: true },
    entity: String,
    entityId: String,
    store: { type: Schema.Types.ObjectId, ref: 'Store', index: true },
    meta: Schema.Types.Mixed,
    ip: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditSchema);
