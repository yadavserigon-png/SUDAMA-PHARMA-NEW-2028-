const mongoose = require('mongoose');

const { Schema } = mongoose;

const deliverySchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    partner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['assigned', 'accepted', 'picked_up', 'out_for_delivery', 'delivered', 'failed', 'returned_to_store', 'cancelled'], default: 'assigned', index: true },
    otpHash: { type: String, select: false },
    otpAttempts: { type: Number, default: 0 },
    events: [{ status: String, at: { type: Date, default: Date.now }, note: String, lat: Number, lng: Number }],
    failureReason: String,
    proofPhoto: { path: String, mimetype: String },
    distanceKm: Number,
    earnings: { type: Number, default: 0 },
    incentive: { type: Number, default: 0 },
    codCollected: { type: Number, default: 0 },
    codSettled: { type: Boolean, default: false },
    trackingActive: { type: Boolean, default: false }, // location sharing allowed only while true
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deliveredAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model('DeliveryAssignment', deliverySchema);
