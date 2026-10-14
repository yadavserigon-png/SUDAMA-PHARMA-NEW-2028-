const mongoose = require('mongoose');

const { Schema } = mongoose;

const prescriptionSchema = new Schema(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', index: true },
    orders: [{ type: Schema.Types.ObjectId, ref: 'Order' }],
    files: [{ path: String, originalName: String, mimetype: String, size: Number }],
    patientName: String,
    doctorName: String,
    doctorRegNo: String,
    prescriptionDate: Date,
    notes: String,
    // Always reviewed by a registered pharmacist - never auto-approved by OCR/AI.
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'clarification'], default: 'pending', index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    reviewNotes: String,
    approvedProducts: [{ product: { type: Schema.Types.ObjectId, ref: 'Product' }, maxQty: Number }],
    validTill: Date,
    source: { type: String, enum: ['web', 'app', 'whatsapp', 'counter'], default: 'web' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Prescription', prescriptionSchema);
