const mongoose = require('mongoose');

const { Schema } = mongoose;

// Physical stock count / reconciliation session
const countSchema = new Schema(
  {
    number: { type: String, unique: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    status: { type: String, enum: ['open', 'submitted', 'approved', 'cancelled'], default: 'open' },
    lines: [{ batch: { type: Schema.Types.ObjectId, ref: 'InventoryBatch' }, product: { type: Schema.Types.ObjectId, ref: 'Product' }, batchNo: String, systemQty: Number, countedQty: Number, variance: Number, note: String }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    notes: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model('StockCount', countSchema);
