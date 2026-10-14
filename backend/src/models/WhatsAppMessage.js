const mongoose = require('mongoose');

const { Schema } = mongoose;

const waSchema = new Schema(
  {
    waMessageId: { type: String, unique: true, sparse: true },
    direction: { type: String, enum: ['in', 'out'], required: true },
    from: String,
    to: String,
    type: String, // text / image / document / template
    text: String,
    media: { id: String, mimetype: String, path: String, caption: String },
    customer: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    request: { type: Schema.Types.ObjectId, ref: 'MedicineRequest' },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    status: String,
    sentBy: { type: Schema.Types.ObjectId, ref: 'User' },
    handled: { type: Boolean, default: false },
    raw: Schema.Types.Mixed,
  },
  { timestamps: true },
);
waSchema.index({ from: 1, createdAt: -1 });

module.exports = mongoose.model('WhatsAppMessage', waSchema);
