const mongoose = require('mongoose');

const { Schema } = mongoose;

const attendanceSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', index: true },
    date: { type: String, required: true }, // YYYY-MM-DD (IST)
    checkIn: Date,
    checkOut: Date,
    status: { type: String, enum: ['present', 'absent', 'half_day', 'leave', 'holiday'], default: 'present' },
    note: String,
    markedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
attendanceSchema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
