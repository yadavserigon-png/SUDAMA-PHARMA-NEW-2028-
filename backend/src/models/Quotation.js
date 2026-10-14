const mongoose = require('mongoose');

const { Schema } = mongoose;

// Wholesale quotation (buyer requests, staff prices it, buyer converts to an order)
const quotationSchema = new Schema(
  {
    number: { type: String, unique: true },
    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    items: [{ product: { type: Schema.Types.ObjectId, ref: 'Product' }, name: String, qty: Number, unitPrice: Number, gstRate: Number }],
    buyerPoNumber: String,
    status: { type: String, enum: ['requested', 'quoted', 'accepted', 'rejected', 'expired', 'converted'], default: 'requested', index: true },
    validTill: Date,
    total: Number,
    notes: String,
    quotedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Quotation', quotationSchema);
