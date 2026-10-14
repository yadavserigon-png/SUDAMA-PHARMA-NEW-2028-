const mongoose = require('mongoose');

const { Schema } = mongoose;

const requestSchema = new Schema(
  {
    number: { type: String, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    name: String,
    phone: { type: String, required: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', index: true },
    pincode: String,
    text: String,
    items: [{ name: String, qty: Number, product: { type: Schema.Types.ObjectId, ref: 'Product' } }],
    files: [{ path: String, originalName: String, mimetype: String, size: Number }],
    source: { type: String, enum: ['web', 'app', 'whatsapp', 'phone', 'counter'], default: 'web' },
    status: { type: String, enum: ['new', 'in_review', 'awaiting_customer', 'quoted', 'converted', 'unavailable', 'closed'], default: 'new', index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    notes: [{ by: { type: Schema.Types.ObjectId, ref: 'User' }, text: String, at: { type: Date, default: Date.now } }],
    customerConfirmedAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model('MedicineRequest', requestSchema);
