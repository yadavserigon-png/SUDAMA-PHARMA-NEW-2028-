const mongoose = require('mongoose');

const { Schema } = mongoose;

const adSchema = new Schema(
  {
    advertiser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    advertiserName: String,
    title: { type: String, required: true },
    placement: { type: String, enum: ['homepage_banner', 'category_promotion', 'sponsored_product', 'delivery_recruitment', 'service_partner'], required: true, index: true },
    category: { type: Schema.Types.ObjectId, ref: 'Category' },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    stores: [{ type: Schema.Types.ObjectId, ref: 'Store' }],
    creative: String, // public image path
    headline: String,
    body: String,
    linkUrl: String,
    budget: { type: Number, default: 0 },
    startAt: Date,
    endAt: Date,
    status: { type: String, enum: ['submitted', 'approved', 'rejected', 'paused', 'ended'], default: 'submitted', index: true },
    reviewNotes: String,
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    complianceChecked: { type: Boolean, default: false }, // no misleading / prohibited drug ads
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    invoice: { number: String, amount: Number, status: { type: String, enum: ['unbilled', 'invoiced', 'paid'], default: 'unbilled' }, paidAt: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Advertisement', adSchema);
