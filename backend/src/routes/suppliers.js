const express = require('express');
const mongoose = require('mongoose');
const Supplier = require('../models/Supplier');
const Purchase = require('../models/Purchase');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { escapeRegex } = require('../utils/paginate');
const { z, validate } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { accessibleStoreIds, storeFilter, toId } = require('../middleware/storeScope');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('suppliers.view', 'suppliers.manage', 'purchases.view'), ah(async (req, res) => {
  const filter = {};
  const allowed = accessibleStoreIds(req.user);
  if (allowed !== null) filter.$or = [{ stores: { $size: 0 } }, { stores: { $in: allowed.map(toId) } }];
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$and = [{ $or: [{ name: rx }, { gstin: rx }, { phone: rx }, { code: rx }] }];
  }
  if (req.query.active !== 'all') filter.active = true;
  const suppliers = await Supplier.find(filter).sort('name').lean();
  // outstanding balances (store-scoped)
  const bal = await Purchase.aggregate([
    { $match: { ...storeFilter(req), supplier: { $in: suppliers.map((s) => s._id) }, status: { $nin: ['draft', 'quotation', 'cancelled'] } } },
    { $group: { _id: '$supplier', invoiced: { $sum: '$totals.invoiceAmount' }, paid: { $sum: '$amountPaid' }, returned: { $sum: '$amountReturned' }, count: { $sum: 1 } } },
  ]);
  const bmap = new Map(bal.map((b) => [String(b._id), b]));
  res.json(suppliers.map((s) => {
    const b = bmap.get(String(s._id)) || { invoiced: 0, paid: 0, returned: 0, count: 0 };
    return { ...s, purchases: b.count, invoiced: b.invoiced, paid: b.paid, outstanding: Math.round((b.invoiced - b.paid - b.returned) * 100) / 100 };
  }));
}));

router.get('/:id', requirePermission('suppliers.view', 'suppliers.manage', 'purchases.view'), ah(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Supplier not found');
  const s = await Supplier.findById(req.params.id).populate('products', 'name sku').lean();
  if (!s) throw new ApiError(404, 'Supplier not found');
  s.purchaseHistory = await Purchase.find({ supplier: s._id, ...storeFilter(req) }).populate('store', 'code name').sort('-createdAt').limit(100).lean({ virtuals: true });
  res.json(s);
}));

const schema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().max(20).optional(),
  contactPerson: z.string().max(120).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.object({ line1: z.string().optional(), city: z.string().optional(), district: z.string().optional(), state: z.string().optional(), pincode: z.string().optional() }).optional(),
  gstin: z.string().trim().max(15).optional(),
  drugLicenseNo: z.string().max(60).optional(),
  drugLicenseValidTill: z.coerce.date().optional(),
  paymentTermsDays: z.number().int().min(0).optional(),
  stores: z.array(z.string()).optional(),
  products: z.array(z.string()).optional(),
  notes: z.string().max(1000).optional(),
  active: z.boolean().optional(),
});

router.post('/', requirePermission('suppliers.manage'), validate(schema), ah(async (req, res) => {
  const allowed = accessibleStoreIds(req.user);
  if (allowed !== null && !(req.body.stores || []).length) req.body.stores = allowed; // store-level users create store-specific suppliers
  const s = await Supplier.create(req.body);
  await audit(req, 'supplier.created', 'Supplier', s._id, { name: s.name });
  res.status(201).json(s);
}));

router.put('/:id', requirePermission('suppliers.manage'), validate(schema.partial()), ah(async (req, res) => {
  const s = await Supplier.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!s) throw new ApiError(404, 'Supplier not found');
  await audit(req, 'supplier.updated', 'Supplier', s._id, { fields: Object.keys(req.body) });
  res.json(s);
}));

module.exports = router;
