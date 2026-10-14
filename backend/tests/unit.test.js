// Pure business-logic tests. Run with: npm run test:unit (no database needed)
const test = require('node:test');
const assert = require('node:assert/strict');

const roles = require('../src/config/roles');
const pricing = require('../src/services/pricing');
const purchase = require('../src/services/purchaseCalc');
const stock = require('../src/services/stockRules');

test('roles: super admin has every permission', () => {
  const u = { role: 'super_admin' };
  for (const p of roles.PERMISSIONS) assert.equal(roles.hasPermission(u, p), true);
});

test('roles: all 14 roles exist and every role has a permission set', () => {
  assert.equal(roles.ROLES.length, 14);
  for (const r of roles.ROLES) assert.ok(Array.isArray(roles.ROLE_PERMISSIONS[r]), r);
});

test('roles: POS operator cannot manage products or override prices', () => {
  const u = { role: 'pos_operator' };
  assert.equal(roles.hasPermission(u, 'pos.use'), true);
  assert.equal(roles.hasPermission(u, 'products.manage'), false);
  assert.equal(roles.hasPermission(u, 'pos.price_override'), false);
});

test('roles: extra and denied permissions are honoured (but cannot deny super admin)', () => {
  assert.equal(roles.hasPermission({ role: 'pos_operator', permissions: ['reports.view'] }, 'reports.view'), true);
  assert.equal(roles.hasPermission({ role: 'store_manager', deniedPermissions: ['reports.view'] }, 'reports.view'), false);
  assert.equal(roles.hasPermission({ role: 'super_admin', deniedPermissions: ['reports.view'] }, 'reports.view'), true);
});

test('roles: only super admin may create admins', () => {
  assert.equal(roles.canAssignRole({ role: 'super_admin' }, 'central_admin'), true);
  assert.equal(roles.canAssignRole({ role: 'central_admin' }, 'central_admin'), false);
  assert.equal(roles.canAssignRole({ role: 'central_admin' }, 'super_admin'), false);
  assert.equal(roles.canAssignRole({ role: 'store_manager' }, 'pos_operator'), true);
  assert.equal(roles.canAssignRole({ role: 'store_manager' }, 'store_manager'), false);
  assert.equal(roles.canAssignRole({ role: 'pos_operator' }, 'customer'), false);
});

test('pricing: GST-inclusive split', () => {
  assert.deepEqual(pricing.splitInclusiveTax(112, 12), { taxable: 100, tax: 12 });
  assert.deepEqual(pricing.splitInclusiveTax(50, 0), { taxable: 50, tax: 0 });
});

test('pricing: discounts never stack - best of product/category/quantity applies, never above MRP', () => {
  const p = { mrp: 100, retailPrice: 100, discountPercent: 10, quantityDiscounts: [{ minQty: 5, percent: 15 }] };
  assert.equal(pricing.unitPrice(p, { qty: 1 }).unitPrice, 90);
  assert.equal(pricing.unitPrice(p, { qty: 5 }).unitPrice, 85);
  assert.equal(pricing.unitPrice(p, { qty: 1, categoryDiscountPercent: 20 }).unitPrice, 80);
  assert.equal(pricing.unitPrice({ mrp: 50, retailPrice: 60 }).unitPrice, 50);
});

test('pricing: wholesale uses wholesale/tier price', () => {
  const p = { mrp: 100, retailPrice: 95, wholesalePrice: 70, tierPrices: [{ tier: 'gold', price: 65 }] };
  assert.equal(pricing.unitPrice(p, { channel: 'wholesale' }).unitPrice, 70);
  assert.equal(pricing.unitPrice(p, { channel: 'wholesale', priceTier: 'gold' }).unitPrice, 65);
});

test('coupons: limits, min order, dates and no stacking with product discounts', () => {
  const now = new Date('2026-10-14T10:00:00Z');
  const c = { active: true, type: 'percent', value: 10, maxDiscount: 30, minOrder: 200, startAt: '2026-10-01', endAt: '2026-10-31', usageLimit: 5, usedCount: 0 };
  const items = [
    { productId: 'a', categoryId: 'x', lineTotal: 500, hasProductDiscount: false },
    { productId: 'b', categoryId: 'y', lineTotal: 100, hasProductDiscount: true },
  ];
  const r = pricing.evaluateCoupon(c, { now, subtotal: 600, items });
  assert.equal(r.ok, true);
  assert.equal(r.eligibleBase, 500);
  assert.equal(r.discount, 30); // capped
  assert.equal(pricing.evaluateCoupon(c, { now, subtotal: 150, items }).ok, false);
  assert.equal(pricing.evaluateCoupon({ ...c, usedCount: 5 }, { now, subtotal: 600, items }).ok, false);
  assert.equal(pricing.evaluateCoupon(c, { now: new Date('2026-11-05'), subtotal: 600, items }).ok, false);
  assert.equal(pricing.evaluateCoupon({ ...c, stores: ['s1'] }, { now, storeId: 's2', subtotal: 600, items }).ok, false);
  assert.equal(pricing.evaluateCoupon({ ...c, categories: ['y'] }, { now, subtotal: 600, items }).ok, false);
});

test('totals: coupon apportioned pro-rata, tax recomputed, totals consistent', () => {
  const t = pricing.computeTotals(
    [
      { unitPrice: 112, mrp: 120, qty: 1, gstRate: 12 },
      { unitPrice: 50, mrp: 50, qty: 2, gstRate: 0 },
    ],
    { couponDiscount: 21.2, deliveryFee: 20 },
  );
  assert.equal(t.subtotal, 212);
  assert.equal(t.mrpTotal, 220);
  assert.equal(t.productDiscount, 8);
  assert.equal(t.couponDiscount, 21.2);
  assert.equal(t.grandTotal, 210.8);
  const shares = t.lines.reduce((s, l) => s + l.couponShare, 0);
  assert.equal(pricing.round2(shares), 21.2);
  assert.equal(t.lines[0].netAmount, 100.8);
  assert.equal(t.lines[0].taxableAmount, 90);
});

test('purchase: free boxes reduce unit cost, not inflate value', () => {
  const product = { stripsPerBox: 10, unitsPerStrip: 10, gstRate: 12 };
  const r = purchase.calcPurchaseLine({ paidQty: 10, freeQty: 1, rate: 1000, purchaseUnit: 'box', sellingPrice: 14 }, product);
  assert.equal(r.unitsPerPack, 100);
  assert.equal(r.totalUnits, 1100);
  assert.equal(r.freeUnits, 100);
  assert.equal(r.taxableAmount, 10000);
  assert.equal(r.gstAmount, 1200);
  assert.equal(r.invoiceAmount, 11200);
  assert.equal(r.costPerUnit, 9.09);
  assert.equal(r.marginPerUnit, 3.41); // 14/1.12 = 12.5 - 9.0909
});

test('purchase: discount and freight in landed cost', () => {
  const r = purchase.calcPurchaseLine({ paidQty: 100, rate: 10, discountPercent: 10, gstRate: 5, otherCharges: 50 });
  assert.equal(r.taxableAmount, 900);
  assert.equal(r.landedCost, 950);
  assert.equal(r.costPerUnit, 9.5);
});

test('stock: expired, recalled and quarantined batches are never sellable', () => {
  const now = new Date('2026-10-14');
  assert.equal(stock.isBatchSellable({ status: 'active', expiryDate: '2026-10-13', qtyAvailable: 5 }, now), false);
  assert.equal(stock.isBatchSellable({ status: 'active', expiryDate: '2026-10-14', qtyAvailable: 5 }, now), false);
  assert.equal(stock.isBatchSellable({ status: 'recalled', expiryDate: '2027-10-14', qtyAvailable: 5 }, now), false);
  assert.equal(stock.isBatchSellable({ status: 'quarantined', expiryDate: '2027-10-14', qtyAvailable: 5 }, now), false);
  assert.equal(stock.isBatchSellable({ status: 'active', expiryDate: '2027-10-14', qtyAvailable: 0 }, now), false);
  assert.equal(stock.isBatchSellable({ status: 'active', expiryDate: '2027-10-14', qtyAvailable: 1 }, now), true);
});

test('stock: FEFO allocation across batches and shortfall detection', () => {
  const now = new Date('2026-10-14');
  const batches = [
    { _id: 'b2', batchNo: 'B2', status: 'active', expiryDate: '2027-06-01', qtyAvailable: 10, costPerUnit: 5 },
    { _id: 'b1', batchNo: 'B1', status: 'active', expiryDate: '2027-01-01', qtyAvailable: 3, costPerUnit: 4 },
    { _id: 'bx', batchNo: 'BX', status: 'active', expiryDate: '2026-01-01', qtyAvailable: 50 },
  ];
  const r = stock.planFefo(batches, 5, now);
  assert.equal(r.shortfall, 0);
  assert.deepEqual(r.allocations.map((a) => [a.batchNo, a.qty]), [['B1', 3], ['B2', 2]]);
  assert.equal(stock.planFefo(batches, 20, now).shortfall, 7);
});

test('expiry alerts: buckets at 180/90/60/30/7 days', () => {
  const now = new Date('2026-10-14');
  assert.equal(stock.expiryBucket('2026-12-01', now).bucket, '60d');
  assert.equal(stock.expiryBucket('2026-10-20', now).bucket, '7d');
  assert.equal(stock.expiryBucket('2027-06-01', now).bucket, null);
  assert.equal(stock.expiryBucket('2026-10-10', now).bucket, 'expired');
});
