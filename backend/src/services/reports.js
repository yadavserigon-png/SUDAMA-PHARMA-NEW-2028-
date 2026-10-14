// Business analytics. Definitions (kept deliberately explicit so owners can trust the numbers):
//  - Revenue is recognised when an order is completed (POS bill paid / online order delivered).
//  - Gross sales      = sum of bill totals incl. GST and delivery fees.
//  - Returns          = value (after discounts, incl. GST) of returned units.
//  - Net sales        = gross sales - returns.
//  - Net revenue      = net sales excluding GST (what the business earns before costs).
//  - COGS             = FEFO batch cost of the units actually sold (free goods lower unit cost).
//  - Gross profit     = net revenue on items - COGS.
//  - Net operating result = gross profit + delivery fees (ex-GST approx) - approved operating expenses
//                           - delivery partner payouts. It is NOT cash flow.
//  - Cash flow        = money actually received - money actually paid out in the period.
// Every order belongs to exactly one store, and stock transfers are never sales, so "All Stores"
// totals are a plain sum of store totals with no double counting.
const Order = require('../models/Order');
const Expense = require('../models/Expense');
const Refund = require('../models/Refund');
const Payment = require('../models/Payment');
const Purchase = require('../models/Purchase');
const DeliveryAssignment = require('../models/DeliveryAssignment');
const InventoryBatch = require('../models/InventoryBatch');
const { startOfDay, DAY } = require('./stockRules');

const TZ = 'Asia/Kolkata';
const REVENUE_STATUSES = ['completed', 'delivered', 'partially_returned', 'returned'];

// ratio of units kept (not returned)
const keptRatio = { $cond: [{ $gt: ['$items.qty', 0] }, { $divide: [{ $subtract: ['$items.qty', { $ifNull: ['$items.returnedQty', 0] }] }, '$items.qty'] }, 0] };

function itemStages(match) {
  return [
    { $match: { ...match, status: { $in: REVENUE_STATUSES } } },
    { $unwind: '$items' },
    { $addFields: {
      kept: keptRatio,
      returnedValue: { $multiply: [{ $ifNull: ['$items.netAmount', 0] }, { $subtract: [1, keptRatio] }] },
    } },
    { $addFields: {
      netRevenue: { $multiply: [{ $ifNull: ['$items.taxableAmount', 0] }, '$kept'] },
      cogs: { $multiply: [{ $ifNull: ['$items.costTotal', 0] }, '$kept'] },
      netSalesItem: { $multiply: [{ $ifNull: ['$items.netAmount', 0] }, '$kept'] },
      gst: { $multiply: [{ $ifNull: ['$items.taxAmount', 0] }, '$kept'] },
      units: { $subtract: ['$items.qty', { $ifNull: ['$items.returnedQty', 0] }] },
    } },
  ];
}

const round = (n) => Math.round((n || 0) * 100) / 100;

async function salesSummary(storeMatch, from, to, extra = {}) {
  const match = { ...storeMatch, ...extra, completedAt: { $gte: from, $lte: to } };
  const [orderTotals, itemTotals] = await Promise.all([
    Order.aggregate([
      { $match: { ...match, status: { $in: REVENUE_STATUSES } } },
      { $group: { _id: null, orders: { $sum: 1 }, grossSales: { $sum: '$grandTotal' }, productDiscount: { $sum: '$productDiscount' }, couponDiscount: { $sum: '$couponDiscount' }, deliveryFees: { $sum: '$deliveryFee' }, mrpTotal: { $sum: '$mrpTotal' } } },
    ]),
    Order.aggregate([
      ...itemStages(match),
      { $group: { _id: null, netRevenue: { $sum: '$netRevenue' }, cogs: { $sum: '$cogs' }, returns: { $sum: '$returnedValue' }, gst: { $sum: '$gst' }, units: { $sum: '$units' } } },
    ]),
  ]);
  const o = orderTotals[0] || {};
  const i = itemTotals[0] || {};
  const grossProfit = (i.netRevenue || 0) - (i.cogs || 0);
  return {
    orders: o.orders || 0,
    units: i.units || 0,
    grossSales: round(o.grossSales),
    returns: round(i.returns),
    netSales: round((o.grossSales || 0) - (i.returns || 0)),
    gstCollected: round(i.gst),
    netRevenue: round(i.netRevenue),
    deliveryFees: round(o.deliveryFees),
    productDiscount: round(o.productDiscount),
    couponDiscount: round(o.couponDiscount),
    cogs: round(i.cogs),
    grossProfit: round(grossProfit),
    grossMarginPercent: i.netRevenue ? round((grossProfit / i.netRevenue) * 100) : 0,
    averageBill: o.orders ? round(o.grossSales / o.orders) : 0,
  };
}

async function breakdown(storeMatch, from, to, groupId, { limit = 50, lookup } = {}) {
  const match = { ...storeMatch, completedAt: { $gte: from, $lte: to } };
  const pipeline = [
    ...itemStages(match),
    { $group: { _id: groupId, netSales: { $sum: '$netSalesItem' }, netRevenue: { $sum: '$netRevenue' }, cogs: { $sum: '$cogs' }, units: { $sum: '$units' }, orderIds: { $addToSet: '$_id' } } },
    { $project: { netSales: { $round: ['$netSales', 2] }, netRevenue: { $round: ['$netRevenue', 2] }, cogs: { $round: ['$cogs', 2] }, grossProfit: { $round: [{ $subtract: ['$netRevenue', '$cogs'] }, 2] }, units: 1, orders: { $size: '$orderIds' } } },
    { $sort: { netSales: -1 } },
    { $limit: limit },
  ];
  if (lookup) pipeline.push({ $lookup: { from: lookup.from, localField: '_id', foreignField: '_id', as: 'ref' } }, { $addFields: { name: { $first: `$ref.${lookup.field}` }, code: { $first: '$ref.code' } } }, { $project: { ref: 0 } });
  return Order.aggregate(pipeline);
}

async function timeSeries(storeMatch, from, to, unit = 'day') {
  const match = { ...storeMatch, completedAt: { $gte: from, $lte: to } };
  return Order.aggregate([
    ...itemStages(match),
    { $group: {
      _id: { period: { $dateTrunc: { date: '$completedAt', unit, timezone: TZ } }, channel: '$channel' },
      netSales: { $sum: '$netSalesItem' }, grossProfit: { $sum: { $subtract: ['$netRevenue', '$cogs'] } },
    } },
    { $group: { _id: '$_id.period', channels: { $push: { k: '$_id.channel', v: { $round: ['$netSales', 2] } } }, netSales: { $sum: '$netSales' }, grossProfit: { $sum: '$grossProfit' } } },
    { $project: { _id: 0, period: '$_id', netSales: { $round: ['$netSales', 2] }, grossProfit: { $round: ['$grossProfit', 2] }, byChannel: { $arrayToObject: '$channels' } } },
    { $sort: { period: 1 } },
  ]);
}

async function paymentMethods(storeMatch, from, to) {
  return Order.aggregate([
    { $match: { ...storeMatch, completedAt: { $gte: from, $lte: to }, status: { $in: REVENUE_STATUSES } } },
    { $group: { _id: '$payment.method', amount: { $sum: '$grandTotal' }, orders: { $sum: 1 } } },
    { $sort: { amount: -1 } },
  ]);
}

async function expensesSummary(storeMatch, from, to) {
  const rows = await Expense.aggregate([
    { $match: { ...storeMatch, status: 'approved', date: { $gte: from, $lte: to } } },
    { $group: { _id: '$category', amount: { $sum: '$amount' } } },
    { $sort: { amount: -1 } },
  ]);
  return { total: round(rows.reduce((s, r) => s + r.amount, 0)), byCategory: rows.map((r) => ({ category: r._id, amount: round(r.amount) })) };
}

async function deliveryCosts(storeMatch, from, to) {
  const r = await DeliveryAssignment.aggregate([
    { $match: { ...storeMatch, status: 'delivered', deliveredAt: { $gte: from, $lte: to } } },
    { $group: { _id: null, payouts: { $sum: { $add: ['$earnings', '$incentive'] } }, deliveries: { $sum: 1 } } },
  ]);
  return { partnerPayouts: round(r[0]?.payouts), deliveries: r[0]?.deliveries || 0 };
}

async function refundsSummary(storeMatch, from, to) {
  const r = await Refund.aggregate([
    { $match: { ...storeMatch, $or: [{ processedAt: { $gte: from, $lte: to } }, { createdAt: { $gte: from, $lte: to } }] } },
    { $group: { _id: '$status', amount: { $sum: { $ifNull: ['$approvedAmount', '$requestedAmount'] } }, count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(r.map((x) => [x._id, { amount: round(x.amount), count: x.count }]));
}

async function purchasesSummary(storeMatch, from, to) {
  const [totals, balances] = await Promise.all([
    Purchase.aggregate([
      { $match: { ...storeMatch, status: { $in: ['ordered', 'partially_received', 'received', 'closed'] }, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, invoiced: { $sum: '$totals.invoiceAmount' }, gst: { $sum: '$totals.gstAmount' }, count: { $sum: 1 } } },
    ]),
    Purchase.aggregate([
      { $match: { ...storeMatch, status: { $in: ['ordered', 'partially_received', 'received', 'closed'] } } },
      { $group: { _id: '$supplier', invoiced: { $sum: '$totals.invoiceAmount' }, paid: { $sum: '$amountPaid' }, returned: { $sum: '$amountReturned' } } },
      { $addFields: { outstanding: { $round: [{ $subtract: [{ $subtract: ['$invoiced', '$paid'] }, '$returned'] }, 2] } } },
      { $match: { outstanding: { $gt: 0.009 } } },
      { $lookup: { from: 'suppliers', localField: '_id', foreignField: '_id', as: 's' } },
      { $project: { outstanding: 1, invoiced: 1, paid: 1, name: { $first: '$s.name' } } },
      { $sort: { outstanding: -1 } },
    ]),
  ]);
  return { invoiced: round(totals[0]?.invoiced), count: totals[0]?.count || 0, supplierBalances: balances, totalOutstanding: round(balances.reduce((s, b) => s + b.outstanding, 0)) };
}

async function cashFlow(storeMatch, from, to) {
  const [inflow, refunds, expenses, supplierPaid] = await Promise.all([
    Payment.aggregate([{ $match: { ...storeMatch, status: 'success', verifiedAt: { $gte: from, $lte: to } } }, { $group: { _id: '$provider', amount: { $sum: '$amount' } } }]),
    Refund.aggregate([{ $match: { ...storeMatch, status: 'processed', processedAt: { $gte: from, $lte: to } } }, { $group: { _id: null, amount: { $sum: '$approvedAmount' } } }]),
    Expense.aggregate([{ $match: { ...storeMatch, status: 'approved', date: { $gte: from, $lte: to } } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
    Purchase.aggregate([{ $match: storeMatch }, { $unwind: '$payments' }, { $match: { 'payments.date': { $gte: from, $lte: to } } }, { $group: { _id: null, amount: { $sum: '$payments.amount' } } }]),
  ]);
  const received = inflow.reduce((s, x) => s + x.amount, 0);
  const out = (refunds[0]?.amount || 0) + (expenses[0]?.amount || 0) + (supplierPaid[0]?.amount || 0);
  return {
    received: round(received),
    receivedBy: inflow.map((x) => ({ provider: x._id, amount: round(x.amount) })),
    refundsPaid: round(refunds[0]?.amount),
    expensesPaid: round(expenses[0]?.amount),
    supplierPayments: round(supplierPaid[0]?.amount),
    netCashFlow: round(received - out),
    note: 'COD cash collected by delivery partners is counted when the delivery is completed; check unsettled COD under Delivery > Performance.',
  };
}

async function inventorySnapshot(storeMatch) {
  const today = startOfDay(new Date());
  const in90 = new Date(today.getTime() + 90 * DAY);
  const r = await InventoryBatch.aggregate([
    { $match: storeMatch },
    { $group: {
      _id: null,
      valueAtCost: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$expiryDate', today] }] }, { $multiply: [{ $add: ['$qtyAvailable', '$qtyReserved'] }, '$costPerUnit'] }, 0] } },
      valueAtMrp: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$expiryDate', today] }] }, { $multiply: [{ $add: ['$qtyAvailable', '$qtyReserved'] }, '$mrp'] }, 0] } },
      expiring90Value: { $sum: { $cond: [{ $and: [{ $gt: ['$expiryDate', today] }, { $lte: ['$expiryDate', in90] }] }, { $multiply: ['$qtyAvailable', '$costPerUnit'] }, 0] } },
      expiring90Batches: { $sum: { $cond: [{ $and: [{ $gt: ['$expiryDate', today] }, { $lte: ['$expiryDate', in90] }, { $gt: ['$qtyAvailable', 0] }] }, 1, 0] } },
      expiredValue: { $sum: { $cond: [{ $lte: ['$expiryDate', today] }, { $multiply: [{ $add: ['$qtyAvailable', '$qtyQuarantined'] }, '$costPerUnit'] }, 0] } },
    } },
  ]);
  const x = r[0] || {};
  return { valueAtCost: round(x.valueAtCost), valueAtMrp: round(x.valueAtMrp), expiring90Value: round(x.expiring90Value), expiring90Batches: x.expiring90Batches || 0, expiredValue: round(x.expiredValue) };
}

async function dashboard(storeMatch, from, to, { unit = 'day', orderFilter = {} } = {}) {
  const om = { ...storeMatch, ...orderFilter }; // employee filter applies to sales only
  const [summary, online, pos, wholesale, series, byStore, byEmployee, byProduct, byCategory, payments, expenses, delivery, refunds, purchases, cash, inventory] = await Promise.all([
    salesSummary(om, from, to),
    salesSummary(om, from, to, { channel: 'online' }),
    salesSummary(om, from, to, { channel: 'pos' }),
    salesSummary(om, from, to, { channel: 'wholesale' }),
    timeSeries(om, from, to, unit),
    breakdown(om, from, to, '$store', { lookup: { from: 'stores', field: 'name' } }),
    breakdown(om, from, to, '$cashier', { lookup: { from: 'users', field: 'name' } }),
    breakdown(om, from, to, '$items.product', { limit: 20, lookup: { from: 'products', field: 'name' } }),
    breakdown(om, from, to, '$items.category', { lookup: { from: 'categories', field: 'name' } }),
    paymentMethods(om, from, to),
    expensesSummary(storeMatch, from, to),
    deliveryCosts(storeMatch, from, to),
    refundsSummary(storeMatch, from, to),
    purchasesSummary(storeMatch, from, to),
    cashFlow(storeMatch, from, to),
    inventorySnapshot(storeMatch),
  ]);
  const deliveryFeesExTax = round(summary.deliveryFees / 1.18);
  const netOperatingResult = round(summary.grossProfit + deliveryFeesExTax - expenses.total - delivery.partnerPayouts);
  return {
    period: { from, to, unit },
    summary,
    channels: { online, pos, wholesale },
    profitAndLoss: {
      netRevenue: summary.netRevenue,
      cogs: summary.cogs,
      grossProfit: summary.grossProfit,
      deliveryFeesExTax,
      operatingExpenses: expenses.total,
      deliveryPartnerPayouts: delivery.partnerPayouts,
      netOperatingResult,
      note: 'Net operating result uses only expenses recorded and approved in this system for the period.',
    },
    series,
    byStore,
    byEmployee: byEmployee.filter((e) => e._id),
    topProducts: byProduct,
    byCategory,
    paymentMethods: payments,
    expenses,
    delivery,
    refunds,
    purchases,
    cashFlow: cash,
    inventory,
  };
}

module.exports = { REVENUE_STATUSES, salesSummary, breakdown, timeSeries, expensesSummary, cashFlow, inventorySnapshot, purchasesSummary, dashboard };
