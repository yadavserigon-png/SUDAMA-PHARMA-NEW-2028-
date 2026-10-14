const mongoose = require('mongoose');

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', index: true },
    audience: { type: String, enum: ['user', 'store_staff', 'admins'], default: 'user' },
    type: String,
    title: String,
    body: String,
    link: String,
    read: { type: Boolean, default: false },
    channels: [{ name: String, status: String, error: String }],
  },
  { timestamps: true },
);
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86400 });

module.exports = mongoose.model('Notification', notificationSchema);
