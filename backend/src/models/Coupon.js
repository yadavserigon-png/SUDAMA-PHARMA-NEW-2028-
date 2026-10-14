const mongoose = require('mongoose');

const { Schema } = mongoose;

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, match: /^[A-Z0-9_-]{3,30}$/ },
    title: String,
    description: String,
    type: { type: String, enum: ['percent', 'flat'], required: true },
    value: { type: Number, required: true, min: 0 },
    maxDiscount: Number,
    minOrder: { type: Number, default: 0 },
    stores: [{ type: Schema.Types.ObjectId, ref: 'Store' }],
    categories: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    products: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    channels: [{ type: String, enum: ['online', 'pos', 'wholesale'] }],
    startAt: Date,
    endAt: Date,
    usageLimit: Number,
    perUserLimit: { type: Number, default: 1 },
    usedCount: { type: Number, default: 0 },
    stackWithProductDiscounts: { type: Boolean, default: false },
    showOnOffersPage: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

couponSchema.pre('validate', function check(next) {
  if (this.type === 'percent' && this.value > 90) this.invalidate('value', 'Percentage discount cannot exceed 90%');
  if (this.startAt && this.endAt && this.endAt < this.startAt) this.invalidate('endAt', 'End date must be after start date');
  next();
});

module.exports = mongoose.model('Coupon', couponSchema);
