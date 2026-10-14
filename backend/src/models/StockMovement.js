const mongoose = require('mongoose');

const { Schema } = mongoose;

// Immutable stock ledger - every quantity change is recorded here (batch traceability + audit).
const movementSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    batch: { type: Schema.Types.ObjectId, ref: 'InventoryBatch', index: true },
    batchNo: String,
    type: {
      type: String,
      enum: ['purchase_in', 'opening', 'sale', 'pos_sale', 'reserve', 'release', 'fulfil', 'transfer_out', 'transfer_in', 'customer_return', 'return_restock', 'return_damaged', 'supplier_return', 'adjustment', 'damage', 'count_correction', 'quarantine', 'recall'],
      required: true,
    },
    qty: { type: Number, required: true }, // signed change in qtyAvailable (reserve/fulfil document reserved moves)
    refType: String,
    refId: String,
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    note: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
movementSchema.index({ store: 1, createdAt: -1 });

module.exports = mongoose.model('StockMovement', movementSchema);
