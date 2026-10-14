const Setting = require('../models/Setting');

// Defaults are used until an authorised admin saves their own values in Settings.
const DEFAULTS = {
  branding: {
    isPublic: true,
    value: {
      platformName: 'Sudama Pharma',
      legalName: 'Sudama Private Limited',
      founder: 'Nitesh Kumar',
      tagline: 'Genuine medicines. Delivered with care.',
      logo: '',
      primaryColor: '#0f766e',
      phone: '9264289295',
      whatsapp: '9264289295',
      email: 'niteshkumar3850022@gmail.com',
      address: 'Bihar, India',
      cin: '',
      gstin: '',
      footerText: '© Sudama Private Limited. All rights reserved.',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      social: { facebook: '', instagram: '', youtube: '' },
      disclaimer: 'Medicines are dispensed only against a valid prescription where required. Information on this site is not a substitute for medical advice.',
    },
  },
  payments: {
    isPublic: false,
    value: {
      upiId: '', // must be supplied and verified by the owner
      upiPayeeName: 'Sudama Private Limited',
      qrImage: '',
      upiVerified: false,
      codEnabled: true,
      codMaxAmount: 5000,
      phonepeEnabled: false,
      contactNumber: '9264289295',
      refundPolicyDays: 7,
    },
  },
  publicPayments: {
    isPublic: true,
    value: { codEnabled: true, phonepeEnabled: false, upiVerified: false, upiId: '', qrImage: '' },
  },
  inventory: {
    isPublic: false,
    value: { expiryAlertDays: [180, 90, 60, 30, 7], defaultExpiryAlertDays: 90, minShelfDaysForOnline: 30, lowStockDefault: 10, deadStockDays: 90 },
  },
  policies: {
    isPublic: true,
    value: {
      returnPolicy: 'Medicines can be returned within 7 days only if sealed, unused, in original packaging and not temperature-sensitive. Returned items are inspected before any refund. Opened strips, refrigerated items and injectables are not returnable.',
      privacyPolicy: 'We collect only the data needed to process orders, verify prescriptions and deliver medicines. Prescriptions are stored securely and visible only to authorised pharmacists.',
      terms: 'Prices include GST. Prescription medicines are dispensed only after verification by a registered pharmacist.',
      shippingPolicy: 'Delivery is available within the service area of the selected store.',
    },
  },
};

async function getSetting(key) {
  const doc = await Setting.findOne({ key }).lean();
  const def = DEFAULTS[key]?.value || {};
  return doc ? { ...def, ...doc.value } : { ...def };
}

async function setSetting(key, value, userId) {
  const isPublic = DEFAULTS[key]?.isPublic || false;
  const current = await getSetting(key);
  const merged = { ...current, ...value };
  await Setting.findOneAndUpdate({ key }, { value: merged, isPublic, updatedBy: userId }, { upsert: true, new: true });
  return merged;
}

module.exports = { DEFAULTS, getSetting, setSetting };
