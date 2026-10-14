const mongoose = require('mongoose');

const { Schema } = mongoose;

const productSchema = new Schema(
  {
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    barcodes: [{ type: String, trim: true }], // GTIN / EAN / internal codes (verified mappings only)
    name: { type: String, required: true, trim: true },
    genericName: { type: String, trim: true },
    brand: { type: String, trim: true },
    manufacturer: { type: String, trim: true },
    marketer: { type: String, trim: true },
    composition: { type: String, trim: true },
    strength: String,
    dosageForm: { type: String, enum: ['tablet', 'capsule', 'syrup', 'suspension', 'injection', 'iv_fluid', 'cream', 'ointment', 'gel', 'drops', 'inhaler', 'powder', 'sachet', 'device', 'surgical', 'other'], default: 'other' },
    packSize: String, // e.g. "Strip of 10 tablets"
    unitsPerStrip: { type: Number, default: 1, min: 1 },
    stripsPerBox: { type: Number, default: 1, min: 1 },
    unitsPerBox: Number,
    sellUnit: { type: String, enum: ['unit', 'strip', 'pack'], default: 'pack' },
    category: { type: Schema.Types.ObjectId, ref: 'Category', index: true },
    subcategory: { type: Schema.Types.ObjectId, ref: 'Category' },
    productType: { type: String, enum: ['branded', 'generic', 'otc', 'surgical', 'device', 'personal_care', 'nutrition', 'other'], default: 'branded' },
    description: String,
    usage: String,
    sideEffects: String,
    safetyAdvice: String,
    storage: String,
    images: [String],
    mrp: { type: Number, required: true, min: 0 },
    purchaseCost: { type: Number, default: 0, min: 0 },
    wholesalePrice: { type: Number, default: 0, min: 0 },
    retailPrice: { type: Number, min: 0 },
    tierPrices: [{ tier: String, price: Number }],
    minWholesaleQty: { type: Number, default: 1 },
    gstRate: { type: Number, enum: [0, 5, 12, 18, 28], default: 12 },
    hsnCode: String,
    discountPercent: { type: Number, default: 0, min: 0, max: 90 },
    quantityDiscounts: [{ minQty: Number, percent: Number }],
    prescriptionRequired: { type: Boolean, default: false },
    // Regulatory classification under the Drugs and Cosmetics Rules (verify per product)
    scheduleClass: { type: String, enum: ['none', 'otc', 'G', 'H', 'H1', 'X', 'narcotic', 'not_for_online'], default: 'none' },
    onlineSaleAllowed: { type: Boolean, default: true },
    coldChain: { type: Boolean, default: false },
    batchTracked: { type: Boolean, default: true },
    lowStockThreshold: { type: Number, default: 10 },
    suppliers: [{ type: Schema.Types.ObjectId, ref: 'Supplier' }],
    substitutes: [{ type: Schema.Types.ObjectId, ref: 'Product' }], // shown as suggestions only, never auto-swapped
    dataVerified: { type: Boolean, default: false }, // product data checked against pack/label
    featured: { type: Boolean, default: false },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

productSchema.index({ barcodes: 1 });
productSchema.index(
  { name: 'text', genericName: 'text', brand: 'text', manufacturer: 'text', composition: 'text', sku: 'text' },
  { weights: { name: 10, brand: 5, genericName: 5, composition: 3, manufacturer: 2, sku: 8 }, name: 'product_text' },
);

productSchema.pre('validate', function setDefaults(next) {
  if (this.retailPrice == null) this.retailPrice = this.mrp;
  if (this.retailPrice > this.mrp) this.invalidate('retailPrice', 'Selling price cannot exceed MRP');
  if (this.wholesalePrice > this.mrp) this.invalidate('wholesalePrice', 'Wholesale price cannot exceed MRP');
  if (['H', 'H1', 'X', 'narcotic'].includes(this.scheduleClass)) this.prescriptionRequired = true;
  if (['X', 'narcotic', 'not_for_online'].includes(this.scheduleClass)) this.onlineSaleAllowed = false;
  next();
});

module.exports = mongoose.model('Product', productSchema);
