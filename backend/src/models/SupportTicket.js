const mongoose = require('mongoose');

const { Schema } = mongoose;

const ticketSchema = new Schema(
  {
    number: { type: String, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    name: String,
    phone: String,
    store: { type: Schema.Types.ObjectId, ref: 'Store', index: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    category: { type: String, enum: ['general', 'order', 'delivery_failure', 'damaged_product', 'wrong_product', 'refund', 'payment_dispute', 'prescription', 'other'], default: 'general' },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    subject: { type: String, required: true },
    status: { type: String, enum: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'], default: 'open', index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    messages: [{ by: { type: Schema.Types.ObjectId, ref: 'User' }, byName: String, text: String, internal: { type: Boolean, default: false }, at: { type: Date, default: Date.now } }],
    resolution: String,
    resolvedAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model('SupportTicket', ticketSchema);
