const Counter = require('../models/Counter');

/** Atomic, collision-free running numbers, e.g. SP-ORD-2026-000123 */
async function nextNumber(name, prefix) {
  const year = new Date().getFullYear();
  const key = `${name}-${year}`;
  const c = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `${prefix}-${year}-${String(c.seq).padStart(6, '0')}`;
}

module.exports = { nextNumber };
