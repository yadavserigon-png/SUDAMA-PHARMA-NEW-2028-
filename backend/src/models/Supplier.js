const mongoose = require('mongoose');

const { Schema } = mongoose;

const supplierSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, uppercase: true, trim: true, unique: true, sparse: true },
    contactPerson: String,
    phone: String,
    email: String,
    address: { line1: String, city: String, district: String, state: { type: String, default: 'Bihar' }, pincode: String },
    gstin: String,
    drugLicenseNo: String,
    drugLicenseValidTill: Date,
    paymentTermsDays: { type: Number, default: 30 },
    stores: [{ type: Schema.Types.ObjectId, ref: 'Store' }], // empty = all stores
    products: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    notes: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Supplier', supplierSchema);
