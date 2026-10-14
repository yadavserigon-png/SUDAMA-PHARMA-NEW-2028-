const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../config/roles');

const { Schema } = mongoose;

const fileSchema = new Schema({ path: String, kind: String, originalName: String, mimetype: String, size: Number, docType: String, verified: { type: Boolean, default: false } }, { _id: true, timestamps: true });

const addressSchema = new Schema({
  label: { type: String, default: 'Home' },
  name: String,
  phone: String,
  line1: { type: String, required: true },
  line2: String,
  landmark: String,
  city: { type: String, required: true },
  district: String,
  state: { type: String, default: 'Bihar' },
  pincode: { type: String, required: true, match: /^\d{6}$/ },
  lat: Number,
  lng: Number,
  isDefault: { type: Boolean, default: false },
});

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, unique: true, trim: true, match: /^[6-9]\d{9}$/ },
    email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'customer', index: true },
    // store-level access for staff; allStores = consolidated access (central roles)
    stores: [{ type: Schema.Types.ObjectId, ref: 'Store', index: true }],
    allStores: { type: Boolean, default: false },
    permissions: [String], // extra grants
    deniedPermissions: [String], // explicit removals
    active: { type: Boolean, default: true },
    phoneVerified: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    verificationCodeHash: { type: String, select: false },
    verificationExpires: { type: Date, select: false },
    tokenVersion: { type: Number, default: 0 },
    failedLogins: { type: Number, default: 0 },
    lockUntil: Date,
    lastLoginAt: Date,
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    addresses: [addressSchema],

    employee: {
      employeeId: { type: String, sparse: true },
      designation: String,
      joiningDate: Date,
      status: { type: String, enum: ['active', 'on_leave', 'resigned', 'terminated'], default: 'active' },
      shift: { name: String, start: String, end: String },
      salary: { type: Number, select: false }, // monthly, restricted (salary.view)
      bankNote: { type: String, select: false },
    },

    deliveryProfile: {
      vehicleType: String,
      vehicleNumber: String,
      licenseNumber: String,
      documents: [fileSchema],
      approved: { type: Boolean, default: false },
      online: { type: Boolean, default: false },
      zones: [String], // PIN codes / zone names
      lastLocation: { lat: Number, lng: Number, at: Date },
      ratePerDelivery: { type: Number, default: 0 },
    },

    wholesale: {
      businessName: String,
      gstin: String,
      drugLicenseNo: String,
      drugLicenseValidTill: Date,
      documents: [fileSchema],
      verified: { type: Boolean, default: false },
      verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      priceTier: String,
      creditLimit: { type: Number, default: 0 },
    },

    advertiser: {
      businessName: String,
      gstin: String,
      documents: [fileSchema],
      verified: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

userSchema.index({ 'employee.employeeId': 1 }, { unique: true, sparse: true });

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
};
userSchema.methods.checkPassword = function checkPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash || '');
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  const o = this.toObject();
  delete o.passwordHash;
  delete o.resetTokenHash;
  delete o.resetTokenExpires;
  delete o.verificationCodeHash;
  delete o.verificationExpires;
  if (o.employee) {
    delete o.employee.salary;
    delete o.employee.bankNote;
  }
  return o;
};

module.exports = mongoose.model('User', userSchema);
