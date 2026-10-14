const mongoose = require('mongoose');

const { Schema } = mongoose;

const shiftSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    counter: { type: String, default: 'Counter 1' },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    openedAt: { type: Date, default: Date.now },
    closedAt: Date,
    openingCash: { type: Number, default: 0 },
    cashSales: { type: Number, default: 0 },
    cashRefunds: { type: Number, default: 0 },
    digitalSales: { type: Number, default: 0 },
    expectedCash: Number,
    countedCash: Number,
    difference: Number,
    billCount: { type: Number, default: 0 },
    notes: String,
  },
  { timestamps: true },
);
shiftSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('Shift', shiftSchema);
