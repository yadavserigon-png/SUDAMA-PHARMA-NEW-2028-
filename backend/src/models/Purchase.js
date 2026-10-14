const mongoose = require('mongoose');

const { Schema } = mongoose;

const purchaseItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: String,
  purchaseUnit: { type: String, enum: ['unit', 'strip', 'box'], default: 'box' },
  unitsPerPack: { type: Number, default: 1 },
  orderedQty: { type: Number, required: true, min: 0 }, // paid quantity in purchase units
  freeQty: { type: Number, default: 0, min: 0 }, // scheme free quantity in purchase units
  receivedQty: { type: Number, default: 0 }, // paid units received (purchase units)
  receivedFreeQty: { type: Number, default: 0 },
  returnedUnits: { type: Number, default: 0 }, // sellable units returned to supplier
  rate: { type: Number, required: true, min: 0 }, // per purchase unit, ex-GST
  discountPercent: { type: Number, default: 0 },
  gstRate: { type: Number, default: 12 },
  mrp: Number, // per sellable unit
  sellingPrice: Number,
});

const purchaseSchema = new Schema(
  {
    number: { type: String, unique: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    kind: { type: String, enum: ['quotation', 'purchase_order'], default: 'purchase_order' },
    status: { type: String, enum: ['draft', 'quotation', 'ordered', 'partially_received', 'received', 'cancelled', 'closed'], default: 'draft' },
    items: [purchaseItemSchema],
    supplierInvoiceNo: String,
    supplierInvoiceDate: Date,
    invoiceFile: { path: String, originalName: String, mimetype: String },
    otherCharges: { type: Number, default: 0 },
    totals: { grossAmount: Number, discountAmount: Number, taxableAmount: Number, gstAmount: Number, invoiceAmount: Number, landedCost: Number },
    amountReturned: { type: Number, default: 0 },
    payments: [{ amount: Number, date: Date, method: String, reference: String, by: { type: Schema.Types.ObjectId, ref: 'User' } }],
    amountPaid: { type: Number, default: 0 },
    expectedDate: Date,
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

purchaseSchema.virtual('outstanding').get(function outstanding() {
  return Math.max(0, Math.round(((this.totals?.invoiceAmount || 0) - (this.amountReturned || 0) - (this.amountPaid || 0)) * 100) / 100);
});
purchaseSchema.set('toJSON', { virtuals: true });
purchaseSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Purchase', purchaseSchema);
