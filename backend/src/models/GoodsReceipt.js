const mongoose = require('mongoose');

const { Schema } = mongoose;

const grnSchema = new Schema(
  {
    number: { type: String, unique: true },
    purchase: { type: Schema.Types.ObjectId, ref: 'Purchase', index: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier' },
    items: [{
      product: { type: Schema.Types.ObjectId, ref: 'Product' },
      batch: { type: Schema.Types.ObjectId, ref: 'InventoryBatch' },
      batchNo: String,
      mfgDate: Date,
      expiryDate: Date,
      paidQty: Number, // purchase units
      freeQty: Number,
      units: Number, // sellable units added to stock
      rate: Number,
      costPerUnit: Number,
      mrp: Number,
      gstRate: Number,
    }],
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model('GoodsReceipt', grnSchema);
