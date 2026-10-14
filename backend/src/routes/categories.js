const express = require('express');
const Category = require('../models/Category');
const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { z, validate } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

router.get('/', ah(async (req, res) => {
  const filter = req.query.all === 'true' ? {} : { active: true };
  const cats = await Category.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
  const counts = await Product.aggregate([{ $match: { active: true } }, { $group: { _id: '$category', n: { $sum: 1 } } }]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.n]));
  const byParent = {};
  for (const c of cats) {
    c.productCount = countMap.get(String(c._id)) || 0;
    (byParent[String(c.parent || 'root')] ||= []).push(c);
  }
  for (const c of cats) c.children = byParent[String(c._id)] || [];
  res.json(req.query.flat === 'true' ? cats : byParent.root || []);
}));

router.get('/:slug', ah(async (req, res) => {
  const c = await Category.findOne({ slug: req.params.slug }).lean();
  if (!c) throw new ApiError(404, 'Category not found');
  c.children = await Category.find({ parent: c._id, active: true }).lean();
  res.json(c);
}));

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().optional(),
  parent: z.string().nullable().optional(),
  description: z.string().max(500).optional(),
  image: z.string().optional(),
  icon: z.string().max(40).optional(),
  discountPercent: z.number().min(0).max(90).optional(),
  sortOrder: z.number().optional(),
  active: z.boolean().optional(),
});

router.post('/', authenticate, requirePermission('categories.manage', 'products.manage'), validate(schema), ah(async (req, res) => {
  const c = await Category.create({ ...req.body, slug: slugify(req.body.slug || req.body.name) });
  await audit(req, 'category.created', 'Category', c._id, { name: c.name });
  res.status(201).json(c);
}));

router.put('/:id', authenticate, requirePermission('categories.manage', 'products.manage'), validate(schema.partial()), ah(async (req, res) => {
  if (req.body.parent && String(req.body.parent) === req.params.id) throw new ApiError(400, 'A category cannot be its own parent');
  if (req.body.slug) req.body.slug = slugify(req.body.slug);
  const c = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!c) throw new ApiError(404, 'Category not found');
  await audit(req, 'category.updated', 'Category', c._id, req.body);
  res.json(c);
}));

module.exports = router;
