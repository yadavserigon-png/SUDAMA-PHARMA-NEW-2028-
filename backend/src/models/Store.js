const mongoose = require('mongoose');

const { Schema } = mongoose;

const storeSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, match: /^[A-Z0-9-]{2,20}$/ },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['retail', 'wholesale', 'retail_wholesale', 'warehouse'], default: 'retail' },
    logo: String,
    address: {
      line1: { type: String, required: true },
      line2: String,
      city: { type: String, required: true },
      district: { type: String, required: true },
      state: { type: String, default: 'Bihar' },
      pincode: { type: String, required: true, match: /^\d{6}$/ },
    },
    location: {
      lat: { type: Number, min: -90, max: 90 },
      lng: { type: Number, min: -180, max: 180 },
    },
    deliveryRadiusKm: { type: Number, default: 5, min: 0, max: 100 },
    serviceablePincodes: [{ type: String, match: /^\d{6}$/ }],
    deliveryZones: [{ name: String, pincodes: [String], fee: { type: Number, default: 0 } }],
    deliveryFee: { type: Number, default: 0 },
    freeDeliveryAbove: { type: Number, default: 0 },
    openingHours: [{ day: { type: Number, min: 0, max: 6 }, open: String, close: String, closed: Boolean }],
    holidays: [{ date: Date, note: String }],
    contact: { phone: String, email: String, whatsapp: String },
    license: {
      retailDrugLicenseNo: String,
      wholesaleDrugLicenseNo: String,
      gstin: String,
      fssaiNo: String,
      pharmacistName: String,
      pharmacistRegNo: String,
      validTill: Date,
    },
    manager: { type: Schema.Types.ObjectId, ref: 'User' },
    acceptsOnlineOrders: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Store', storeSchema);
