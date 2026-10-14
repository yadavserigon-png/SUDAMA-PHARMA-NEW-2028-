const mongoose = require('mongoose');

const { Schema } = mongoose;

const ORDER_STATUSES = [
  'placed', 'prescription_review', 'payment_pending', 'confirmed', 'packing', 'ready_for_pickup',
  'assigned', 'picked_up', 'out_for_delivery', 'delivered', 'completed', 'cancelled', 'returned', 'partially_returned', 'delivery_failed',
];

const allocationSchema = new Schema({
  batch: { type: Schema.Types.ObjectId, ref: 'InventoryBatch' },
  batchNo: String,
  expiryDate: Date,
  qty: Number,
  unitCost: Number,
}, { _id: false });

const itemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  name: String,
  sku: String,
  category: { type: Schema.Types.ObjectId, ref: 'Category' },
  prescriptionRequired: Boolean,
  qty: { type: Number, required: true, min: 1 },
  fulfilledQty: Number, // for partial fulfilment
  returnedQty: { type: Number, default: 0 },
  mrp: Number,
  unitPrice: Number,
  discountPercent: Number,
  lineTotal: Number, // unitPrice * qty (GST incl.)
  couponShare: Number,
  netAmount: Number, // after coupon (GST incl.)
  gstRate: Number,
  taxableAmount: Number,
  taxAmount: Number,
  costTotal: Number, // sum(allocation.qty * unitCost) - used for gross profit
  priceOverride: { by: { type: Schema.Types.ObjectId, ref: 'User' }, original: Number, reason: String },
  allocations: [allocationSchema],
});

const orderSchema = new Schema(
  {
    orderNumber: { type: String, unique: true },
    channel: { type: String, enum: ['online', 'pos', 'wholesale', 'whatsapp'], required: true, index: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    customerName: String,
    customerPhone: String,
    items: [itemSchema],
    mrpTotal: Number,
    subtotal: Number,
    productDiscount: Number,
    couponCode: String,
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon' },
    couponDiscount: { type: Number, default: 0 },
    taxTotal: Number,
    deliveryFee: { type: Number, default: 0 },
    grandTotal: Number,
    refundedAmount: { type: Number, default: 0 },
    payment: {
      method: { type: String, enum: ['cod', 'upi_gateway', 'phonepe', 'cash', 'card', 'upi_pos', 'credit'], required: true },
      status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded', 'not_required'], default: 'pending' },
      reference: String,
      paidAt: Date,
      cashTendered: Number,
      changeReturned: Number,
    },
    prescriptionRequired: { type: Boolean, default: false },
    prescriptions: [{ type: Schema.Types.ObjectId, ref: 'Prescription' }],
    prescriptionStatus: { type: String, enum: ['not_required', 'pending', 'approved', 'rejected', 'clarification'], default: 'not_required' },
    status: { type: String, enum: ORDER_STATUSES, default: 'placed', index: true },
    stockState: { type: String, enum: ['none', 'reserved', 'fulfilled', 'released'], default: 'none' },
    address: {
      name: String, phone: String, line1: String, line2: String, landmark: String, city: String, district: String, state: String, pincode: String, lat: Number, lng: Number,
    },
    deliveryType: { type: String, enum: ['delivery', 'pickup', 'counter'], default: 'delivery' },
    delivery: { type: Schema.Types.ObjectId, ref: 'DeliveryAssignment' },
    deliveryOtp: { type: String, select: false }, // shown only to the customer who owns the order
    timeline: [{ status: String, at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, note: String }],
    cashier: { type: Schema.Types.ObjectId, ref: 'User', index: true }, // sales attribution
    shift: { type: Schema.Types.ObjectId, ref: 'Shift' },
    returnOf: { type: Schema.Types.ObjectId, ref: 'Order' },
    medicineRequest: { type: Schema.Types.ObjectId, ref: 'MedicineRequest' },
    idempotencyKey: { type: String },
    notes: String,
    cancelReason: String,
    completedAt: { type: Date, index: true }, // revenue recognised at completion (delivered / POS paid)
  },
  { timestamps: true },
);

orderSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
orderSchema.index({ store: 1, createdAt: -1 });
orderSchema.index({ store: 1, completedAt: -1 });

orderSchema.methods.pushStatus = function pushStatus(status, by, note) {
  this.status = status;
  this.timeline.push({ status, by, note, at: new Date() });
};

const Order = mongoose.model('Order', orderSchema);
Order.ORDER_STATUSES = ORDER_STATUSES;
module.exports = Order;
