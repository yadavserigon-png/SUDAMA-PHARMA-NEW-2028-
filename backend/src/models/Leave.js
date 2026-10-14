const mongoose = require('mongoose');

const { Schema } = mongoose;

const leaveSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', index: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    type: { type: String, enum: ['casual', 'sick', 'earned', 'unpaid', 'other'], default: 'casual' },
    reason: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Leave', leaveSchema);
