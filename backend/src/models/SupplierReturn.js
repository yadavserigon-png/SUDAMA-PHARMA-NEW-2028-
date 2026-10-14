const mongoose = require('mongoose');

const { Schema } = mongoose;

const supplierReturnSchema = new Schema(
  {
    number: { type: String, unique: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    purchase: { type: Schema.Types.ObjectId, ref: 'Purchase' },
    items: [{ product: { type: Schema.Types.ObjectId, ref: 'Product' }, batch: { type: Schema.Types.ObjectId, ref: 'InventoryBatch' }, batchNo: String, qty: Number, from: { type: String, enum: ['available', 'damaged', 'quarantined'] }, value: Number }],
    reason: { type: String, enum: ['expired', 'near_expiry', 'damaged', 'recall', 'wrong_item', 'excess', 'other'], default: 'other' },
    creditNoteNo: String,
    totalValue: Number,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('SupplierReturn', supplierReturnSchema);
