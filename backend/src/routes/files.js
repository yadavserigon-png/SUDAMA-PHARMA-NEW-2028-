// Secure access to private files (prescriptions, KYC documents, receipts, WhatsApp media).
const express = require('express');
const fs = require('fs');
const path = require('path');
const Prescription = require('../models/Prescription');
const MedicineRequest = require('../models/MedicineRequest');
const User = require('../models/User');
const Expense = require('../models/Expense');
const Purchase = require('../models/Purchase');
const PartnerApplication = require('../models/PartnerApplication');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { authenticate } = require('../middleware/auth');
const { hasPermission } = require('../config/roles');
const { canAccessStore } = require('../middleware/storeScope');
const { PRIVATE_DIR } = require('../middleware/upload');

const router = express.Router();
router.use(authenticate);

async function authorise(req, name) {
  const u = req.user;
  const own = (id) => String(id) === String(u._id);
  const p = await Prescription.findOne({ 'files.path': name }).lean();
  if (p) return own(p.customer) || (hasPermission(u, 'prescriptions.review') && (!p.store || canAccessStore(u, p.store)));
  const r = await MedicineRequest.findOne({ 'files.path': name }).lean();
  if (r) return own(r.customer) || (hasPermission(u, 'requests.manage') && (!r.store || canAccessStore(u, r.store)));
  const owner = await User.findOne({ $or: [{ 'deliveryProfile.documents.path': name }, { 'wholesale.documents.path': name }, { 'advertiser.documents.path': name }] }).lean();
  if (owner) return own(owner._id) || hasPermission(u, 'delivery.manage') || hasPermission(u, 'wholesale.manage') || hasPermission(u, 'ads.manage');
  const e = await Expense.findOne({ 'receipt.path': name }).lean();
  if (e) return hasPermission(u, 'expenses.manage') && canAccessStore(u, e.store);
  const pu = await Purchase.findOne({ 'invoiceFile.path': name }).lean();
  if (pu) return hasPermission(u, 'purchases.view') && canAccessStore(u, pu.store);
  const app = await PartnerApplication.findOne({ 'documents.path': name }).lean();
  if (app) return hasPermission(u, 'ads.manage') || hasPermission(u, 'delivery.manage') || hasPermission(u, 'wholesale.manage');
  const wa = await WhatsAppMessage.findOne({ 'media.path': name }).lean();
  if (wa) return hasPermission(u, 'whatsapp.manage') || hasPermission(u, 'requests.manage');
  return false;
}

router.get('/:name', ah(async (req, res) => {
  const name = path.basename(req.params.name); // no path traversal
  if (!(await authorise(req, name))) throw new ApiError(404, 'File not found');
  const full = path.join(PRIVATE_DIR, name);
  if (!fs.existsSync(full)) throw new ApiError(404, 'File not found');
  if (req.user.role !== 'customer') await audit(req, 'file.viewed', 'File', name);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(full);
}));

module.exports = router;
