// Wholesale buyer portal: registration, verification-gated catalogue, quotations, bulk orders.
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const Quotation = require('../models/Quotation');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { nextNumber } = require('../utils/sequence');
const { escapeRegex, paginate } = require('../utils/paginate');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { storeFilter, assertStoreAccess } = require('../middleware/storeScope');
const { hasPermission } = require('../config/roles');
const { privateDocUpload, checkFiles, fileMeta } = require('../middleware/upload');
const { signToken } = require('../middleware/auth');
const pricing = require('../services/pricing');
const orderSvc = require('../services/orders');
const Order = require('../models/Order');

const router = express.Router();

router.post('/register', privateDocUpload.array('documents', 5), checkFiles, ah(async (req, res) => {
  const b = z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().regex(/^[6-9]\d{9}$/),
    email: z.string().email().optional().or(z.literal('')),
    password: z.string().min(8).regex(/[A-Za-z]/).regex(/\d/),
    businessName: z.string().trim().min(2).max(160),
    gstin: z.string().trim().regex(/^[0-9A-Z]{15}$/, 'GSTIN must be 15 characters'),
    drugLicenseNo: z.string().trim().min(3).max(60),
    drugLicenseValidTill: z.coerce.date(),
  }).parse(req.body);
  if (await User.exists({ phone: b.phone })) throw new ApiError(409, 'Mobile number already registered');
  const user = new User({
    name: b.name, phone: b.phone, email: b.email || undefined, role: 'wholesale_buyer',
    wholesale: { businessName: b.businessName, gstin: b.gstin, drugLicenseNo: b.drugLicenseNo, drugLicenseValidTill: b.drugLicenseValidTill, documents: (req.files || []).map((f) => ({ ...fileMeta(f), docType: 'licence' })), verified: false },
  });
  await user.setPassword(b.password);
  await user.save();
  res.status(201).json({ token: signToken(user), user: user.toSafeJSON(), message: 'Registered. Your licence and GST details will be verified before wholesale ordering is enabled.' });
}));

router.use(authenticate);

function assertEligible(user) {
  if (user.role !== 'wholesale_buyer') throw new ApiError(403, 'Wholesale buyer account required');
  if (!user.wholesale?.verified) throw new ApiError(403, 'Your business verification is pending');
  if (!user.wholesale.drugLicenseValidTill || new Date(user.wholesale.drugLicenseValidTill) < new Date()) throw new ApiError(403, 'Your drug licence on file has expired. Upload the renewed licence.');
}

router.get('/me', requirePermission('wholesale.self'), (req, res) => res.json(req.user.toSafeJSON()));

router.post('/me/documents', requirePermission('wholesale.self'), privateDocUpload.single('file'), checkFiles, ah(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded');
  const b = z.object({ docType: z.string().max(40).default('licence'), drugLicenseValidTill: z.coerce.date().optional() }).parse(req.body);
  req.user.wholesale.documents.push({ ...fileMeta(req.file), docType: b.docType });
  if (b.drugLicenseValidTill) {
    req.user.wholesale.drugLicenseValidTill = b.drugLicenseValidTill;
    req.user.wholesale.verified = false; // renewed licence must be re-verified
  }
  await req.user.save();
  res.json(req.user.toSafeJSON());
}));

router.get('/catalog', requirePermission('wholesale.self', 'wholesale.manage'), ah(async (req, res) => {
  if (req.user.role === 'wholesale_buyer') assertEligible(req.user);
  const { page, limit, skip } = paginate(req, { defaultLimit: 50 });
  const filter = { active: true };
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ name: rx }, { brand: rx }, { composition: rx }, { sku: rx }];
  }
  const items = await Product.find(filter).sort('name').skip(skip).limit(limit).lean();
  const tier = req.user.wholesale?.priceTier;
  res.json(items.map((p) => ({
    _id: p._id, name: p.name, sku: p.sku, brand: p.brand, manufacturer: p.manufacturer, composition: p.composition, packSize: p.packSize,
    mrp: p.mrp, wholesalePrice: pricing.unitPrice(p, { channel: 'wholesale', priceTier: tier }).unitPrice, minWholesaleQty: p.minWholesaleQty, gstRate: p.gstRate, prescriptionRequired: p.prescriptionRequired,
  })));
}));

// ---------- Quotations ----------
router.post('/quotations', requirePermission('wholesale.self'), validate(z.object({ storeId: objectId, items: z.array(z.object({ productId: objectId, qty: z.number().int().min(1) })).min(1).max(200), buyerPoNumber: z.string().max(60).optional(), notes: z.string().max(1000).optional() })), ah(async (req, res) => {
  assertEligible(req.user);
  const products = await Product.find({ _id: { $in: req.body.items.map((i) => i.productId) }, active: true }).lean();
  const pmap = new Map(products.map((p) => [String(p._id), p]));
  const q = await Quotation.create({
    number: await nextNumber('ws-quote', 'SP-WQ'), buyer: req.user._id, store: req.body.storeId, buyerPoNumber: req.body.buyerPoNumber, notes: req.body.notes,
    items: req.body.items.map((i) => {
      const p = pmap.get(String(i.productId));
      if (!p) throw new ApiError(400, 'Product not found');
      return { product: p._id, name: p.name, qty: i.qty, unitPrice: pricing.unitPrice(p, { channel: 'wholesale', priceTier: req.user.wholesale.priceTier }).unitPrice, gstRate: p.gstRate };
    }),
  });
  res.status(201).json(q);
}));

router.get('/quotations', ah(async (req, res) => {
  let filter;
  if (req.user.role === 'wholesale_buyer') filter = { buyer: req.user._id };
  else if (hasPermission(req.user, 'wholesale.manage')) filter = storeFilter(req);
  else throw new ApiError(403, 'No access');
  if (req.query.status) filter.status = req.query.status;
  res.json(await Quotation.find(filter).populate('buyer', 'name phone wholesale.businessName').populate('store', 'code name').sort('-createdAt').limit(200).lean());
}));

router.post('/quotations/:id/quote', requirePermission('wholesale.manage'), validate(z.object({ items: z.array(z.object({ itemId: objectId, unitPrice: z.number().positive() })).min(1), validTill: z.coerce.date(), notes: z.string().max(1000).optional() })), ah(async (req, res) => {
  const q = await Quotation.findById(req.params.id);
  if (!q) throw new ApiError(404, 'Quotation not found');
  assertStoreAccess(req.user, q.store);
  if (!['requested', 'quoted'].includes(q.status)) throw new ApiError(400, 'Quotation can no longer be priced');
  const products = await Product.find({ _id: { $in: q.items.map((i) => i.product) } }).lean();
  const pmap = new Map(products.map((p) => [String(p._id), p]));
  for (const it of req.body.items) {
    const line = q.items.id(it.itemId);
    if (!line) throw new ApiError(400, 'Line not found');
    if (it.unitPrice > pmap.get(String(line.product)).mrp) throw new ApiError(400, `Price for ${line.name} cannot exceed MRP`);
    line.unitPrice = it.unitPrice;
  }
  q.total = pricing.round2(q.items.reduce((s, i) => s + i.unitPrice * i.qty, 0));
  q.validTill = req.body.validTill;
  q.status = 'quoted';
  q.quotedBy = req.user._id;
  if (req.body.notes) q.notes = req.body.notes;
  await q.save();
  await audit(req, 'wholesale.quoted', 'Quotation', q._id, { total: q.total }, q.store);
  res.json(q);
}));

async function placeWholesaleOrder(req, { storeId, items, buyerPoNumber, paymentMethod, quote }) {
  assertEligible(req.user);
  const lines = await orderSvc.priceLines(items, { channel: 'wholesale', priceTier: req.user.wholesale.priceTier, allowOverride: Boolean(quote), user: req.user });
  const preview = pricing.computeTotals(lines);
  if (paymentMethod === 'credit') {
    const open = await Order.aggregate([{ $match: { customer: req.user._id, channel: 'wholesale', 'payment.status': 'pending', status: { $ne: 'cancelled' } } }, { $group: { _id: null, s: { $sum: '$grandTotal' } } }]);
    const used = open[0]?.s || 0;
    if (used + preview.grandTotal > (req.user.wholesale.creditLimit || 0)) throw new ApiError(400, `Credit limit exceeded. Available credit ₹${Math.max(0, (req.user.wholesale.creditLimit || 0) - used)}`);
  }
  const order = await orderSvc.createOrderWithStock({
    channel: 'wholesale', storeId: new mongoose.Types.ObjectId(storeId), lines, user: req.user, customerId: req.user._id, stockMode: 'reserve',
    base: {
      customerName: req.user.wholesale.businessName, customerPhone: req.user.phone, deliveryType: 'pickup',
      payment: { method: paymentMethod === 'credit' ? 'credit' : 'upi_gateway', status: 'pending' },
      prescriptionStatus: 'not_required', status: 'confirmed',
      timeline: [{ status: 'confirmed', by: req.user._id, note: `Wholesale order${buyerPoNumber ? `, buyer PO ${buyerPoNumber}` : ''}${quote ? `, quotation ${quote.number}` : ''}` }],
      notes: buyerPoNumber ? `Buyer PO: ${buyerPoNumber}` : undefined,
    },
  });
  // wholesale buyers are licensed; prescription gating does not apply to licensed trade sales
  order.prescriptionRequired = false;
  await order.save();
  return order;
}

router.post('/quotations/:id/accept', requirePermission('wholesale.self'), validate(z.object({ paymentMethod: z.enum(['credit', 'bank']) })), ah(async (req, res) => {
  const q = await Quotation.findById(req.params.id);
  if (!q || String(q.buyer) !== String(req.user._id)) throw new ApiError(404, 'Quotation not found');
  if (q.status !== 'quoted') throw new ApiError(400, 'Quotation is not ready');
  if (q.validTill && q.validTill < new Date()) {
    q.status = 'expired';
    await q.save();
    throw new ApiError(400, 'Quotation has expired');
  }
  const order = await placeWholesaleOrder(req, {
    storeId: q.store, buyerPoNumber: q.buyerPoNumber, paymentMethod: req.body.paymentMethod, quote: q,
    items: q.items.map((i) => ({ productId: i.product, qty: i.qty, unitPrice: i.unitPrice, overrideReason: `Quotation ${q.number}` })),
  });
  q.status = 'converted';
  q.order = order._id;
  await q.save();
  res.status(201).json(order);
}));

router.post('/orders', requirePermission('wholesale.self'), validate(z.object({ storeId: objectId, items: z.array(z.object({ productId: objectId, qty: z.number().int().min(1) })).min(1).max(200), buyerPoNumber: z.string().max(60).optional(), paymentMethod: z.enum(['credit', 'bank']) })), ah(async (req, res) => {
  res.status(201).json(await placeWholesaleOrder(req, req.body));
}));

module.exports = router;
