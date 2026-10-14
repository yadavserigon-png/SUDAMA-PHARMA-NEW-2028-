const mongoose = require('mongoose');

const { Schema } = mongoose;

const refundSchema = new Schema(
  {
    number: { type: String, unique: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User' },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
    items: [{ product: { type: Schema.Types.ObjectId, ref: 'Product' }, qty: Number }],
    reason: String,
    requestedAmount: { type: Number, required: true, min: 0 },
    approvedAmount: Number,
    method: { type: String, enum: ['original', 'cash', 'bank_transfer', 'store_credit'], default: 'original' },
    status: { type: String, enum: ['requested', 'approved', 'rejected', 'processed', 'failed'], default: 'requested', index: true },
    paymentReference: String,
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    processedAt: Date,
    notes: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model('Refund', refundSchema);
