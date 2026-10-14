const mongoose = require('mongoose');

const { Schema } = mongoose;

const taskSchema = new Schema(
  {
    title: { type: String, required: true },
    description: String,
    store: { type: Schema.Types.ObjectId, ref: 'Store', index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    dueAt: Date,
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status: { type: String, enum: ['todo', 'in_progress', 'done', 'cancelled'], default: 'todo', index: true },
    completedAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model('Task', taskSchema);
