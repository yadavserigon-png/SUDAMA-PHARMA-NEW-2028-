const mongoose = require('mongoose');
const { toCalendarDate } = require('../utils/dates');

const { Schema } = mongoose;

const batchSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    batchNo: { type: String, required: true, trim: true, uppercase: true },
    mfgDate: { type: Date, set: toCalendarDate },
    expiryDate: { type: Date, required: true, set: toCalendarDate },
    purchaseRate: { type: Number, default: 0, min: 0 }, // invoice rate per sellable unit (ex-GST)
    costPerUnit: { type: Number, default: 0, min: 0 }, // effective landed cost incl. free goods
    mrp: { type: Number, required: true, min: 0 },
    qtyReceived: { type: Number, default: 0, min: 0 },
    qtyAvailable: { type: Number, default: 0, min: 0 },
    qtyReserved: { type: Number, default: 0, min: 0 },
    qtyDamaged: { type: Number, default: 0, min: 0 },
    qtyQuarantined: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['active', 'quarantined', 'recalled', 'blocked'], default: 'active' },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier' },
    grnRef: { type: Schema.Types.ObjectId, ref: 'GoodsReceipt' },
    source: { type: String, enum: ['purchase', 'opening', 'transfer', 'adjustment', 'import', 'return'], default: 'purchase' },
    notes: String,
  },
  { timestamps: true },
);

batchSchema.index({ store: 1, product: 1, batchNo: 1 }, { unique: true });
batchSchema.index({ store: 1, product: 1, status: 1, expiryDate: 1 });
batchSchema.index({ store: 1, expiryDate: 1 });

module.exports = mongoose.model('InventoryBatch', batchSchema);
