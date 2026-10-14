const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat('en-IN');

export const inr = (n) => inrFmt.format(Number(n) || 0);
export const num = (n) => numFmt.format(Number(n) || 0);
export const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '');
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export const monthYear = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', year: 'numeric' }) : '');
export const today = (offset = 0) => new Date(Date.now() + offset * 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);
export const label = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const STATUS_COLORS = {
  green: ['delivered', 'completed', 'paid', 'approved', 'active', 'in_stock', 'success', 'received', 'resolved', 'processed', 'present', 'converted', 'done'],
  amber: ['pending', 'prescription_review', 'payment_pending', 'low_stock', 'packing', 'ready_for_pickup', 'requested', 'in_review', 'open', 'in_progress', 'partially_received', 'quoted', 'submitted', 'clarification', 'awaiting_customer', 'dispatched', 'ordered'],
  red: ['cancelled', 'rejected', 'failed', 'out_of_stock', 'expired', 'recalled', 'delivery_failed', 'quarantined', 'blocked', 'absent', 'urgent'],
  blue: ['confirmed', 'assigned', 'picked_up', 'out_for_delivery', 'accepted', 'refunded', 'partially_refunded', 'returned', 'partially_returned'],
};
export function statusColor(s) {
  for (const [c, list] of Object.entries(STATUS_COLORS)) if (list.includes(s)) return c;
  return '';
}
