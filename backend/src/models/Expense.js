const mongoose = require('mongoose');

const { Schema } = mongoose;

const EXPENSE_CATEGORIES = ['rent', 'salaries', 'electricity', 'internet', 'delivery', 'packaging', 'maintenance', 'marketing', 'licenses', 'software', 'travel', 'other'];

const expenseSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    date: { type: Date, required: true, index: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    amount: { type: Number, required: true, min: 0 },
    vendor: String,
    paymentMethod: { type: String, enum: ['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other'], default: 'cash' },
    reference: String,
    notes: String,
    receipt: { path: String, originalName: String, mimetype: String },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

const Expense = mongoose.model('Expense', expenseSchema);
Expense.CATEGORIES = EXPENSE_CATEGORIES;
module.exports = Expense;
