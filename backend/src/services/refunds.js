const Refund = require('../models/Refund');
const Payment = require('../models/Payment');
const { nextNumber } = require('../utils/sequence');
const { round2 } = require('./pricing');

/** Create a refund request for a paid order. Approval is a separate, permissioned step. */
async function requestRefund(order, { amount, reason, items, user, method = 'original' }) {
  const refundable = round2((order.grandTotal || 0) - (order.refundedAmount || 0));
  const amt = round2(Math.min(amount, refundable));
  if (amt <= 0) return null;
  const payment = await Payment.findOne({ order: order._id, status: 'success' }).sort('-createdAt').lean();
  return Refund.create({
    number: await nextNumber('refund', 'SP-RF'),
    order: order._id,
    store: order.store,
    customer: order.customer,
    payment: payment?._id,
    items,
    reason,
    requestedAmount: amt,
    method,
    requestedBy: user?._id,
  });
}

module.exports = { requestRefund };
