const mongoose = require('mongoose');
const env = require('../config/env');

const { Schema } = mongoose;

// Real GPS points sent by the delivery partner's device during an active delivery only.
const locationSchema = new Schema({
  partner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  assignment: { type: Schema.Types.ObjectId, ref: 'DeliveryAssignment', required: true, index: true },
  lat: { type: Number, required: true, min: -90, max: 90 },
  lng: { type: Number, required: true, min: -180, max: 180 },
  accuracy: Number,
  at: { type: Date, default: Date.now },
});
// Data retention: location points are deleted automatically after N days
locationSchema.index({ at: 1 }, { expireAfterSeconds: env.locationRetentionDays * 86400 });

module.exports = mongoose.model('LocationUpdate', locationSchema);
