const mongoose = require('mongoose');

const { Schema } = mongoose;

const paymentSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', index: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User' },
    amount: { type: Number, required: true },
    method: String,
    provider: { type: String, enum: ['phonepe', 'cash', 'pos_upi', 'card', 'cod', 'manual_bank', 'credit'], required: true },
    status: { type: String, enum: ['created', 'pending', 'success', 'failed', 'refunded'], default: 'created', index: true },
    merchantTransactionId: { type: String, unique: true, sparse: true },
    providerReference: String,
    verifiedBy: { type: String, enum: ['gateway_status_api', 'gateway_callback', 'staff_bank_check', 'cash_counter'] },
    verifiedByUser: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: Date,
    raw: Schema.Types.Mixed,
    note: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model('Payment', paymentSchema);
