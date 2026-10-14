const mongoose = require('mongoose');

const { Schema } = mongoose;

const redemptionSchema = new Schema(
  {
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', unique: true },
    discount: Number,
  },
  { timestamps: true },
);

module.exports = mongoose.model('CouponRedemption', redemptionSchema);
