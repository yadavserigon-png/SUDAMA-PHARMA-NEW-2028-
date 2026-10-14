const mongoose = require('mongoose');

const { Schema } = mongoose;

const transferSchema = new Schema(
  {
    number: { type: String, unique: true },
    fromStore: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    toStore: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    status: { type: String, enum: ['requested', 'dispatching', 'dispatched', 'receiving', 'received', 'cancelled'], default: 'requested' },
    items: [{
      product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
      qty: { type: Number, required: true, min: 1 },
      receivedQty: Number,
      allocations: [{ batch: { type: Schema.Types.ObjectId, ref: 'InventoryBatch' }, batchNo: String, expiryDate: Date, mfgDate: Date, qty: Number, unitCost: Number, mrp: Number }],
    }],
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    dispatchedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    dispatchedAt: Date,
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    receivedAt: Date,
    notes: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model('StockTransfer', transferSchema);
