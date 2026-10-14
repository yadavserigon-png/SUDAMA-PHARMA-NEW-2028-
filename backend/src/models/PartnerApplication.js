const mongoose = require('mongoose');

const { Schema } = mongoose;

const appSchema = new Schema(
  {
    type: { type: String, enum: ['advertiser', 'delivery_partner', 'delivery_service', 'wholesale_buyer', 'supplier'], required: true, index: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: String,
    businessName: String,
    gstin: String,
    licenseNo: String,
    city: String,
    district: String,
    message: String,
    documents: [{ path: String, originalName: String, mimetype: String, size: Number }],
    status: { type: String, enum: ['new', 'under_review', 'approved', 'rejected'], default: 'new', index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewNotes: String,
    linkedUser: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('PartnerApplication', appSchema);
