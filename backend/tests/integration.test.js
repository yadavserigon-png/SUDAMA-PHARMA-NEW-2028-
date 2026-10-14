// End-to-end API tests against an in-memory MongoDB.
// Run: npm test   (needs devDependencies installed: mongodb-memory-server, supertest)
// The first run downloads a MongoDB binary (~70 MB) once.
process.env.NODE_ENV = 'test';
process.env.SETUP_TOKEN = 'test-setup-token-123456';
process.env.WHATSAPP_APP_SECRET = 'wa-test-secret';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

let MongoMemoryServer;
let request;
try {
  ({ MongoMemoryServer } = require('mongodb-memory-server'));
  request = require('supertest');
} catch {
  test('integration tests', { skip: 'devDependencies not installed (npm install)' }, () => {});
  return;
}
const mongoose = require('mongoose');
const { connectDB } = require('../src/config/db');
const { createApp } = require('../src/app');

let mongod;
let app;
const ctx = {};
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const auth = (t) => ({ Authorization: `Bearer ${t}` });

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await connectDB(mongod.getUri('sudama_pharma_platform_test'));
  app = createApp();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('health', async () => {
  const r = await request(app).get('/api/health');
  assert.equal(r.status, 200);
});

test('super admin setup requires the setup token and happens once', async () => {
  const bad = await request(app).post('/api/auth/setup').send({ setupToken: 'wrong-token', name: 'Nitesh Kumar', phone: '9264289295', email: 'niteshkumar3850022@gmail.com', password: 'Owner@2026x' });
  assert.equal(bad.status, 403);
  const ok = await request(app).post('/api/auth/setup').send({ setupToken: process.env.SETUP_TOKEN, name: 'Nitesh Kumar', phone: '9264289295', email: 'niteshkumar3850022@gmail.com', password: 'Owner@2026x' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.user.role, 'super_admin');
  assert.equal(ok.body.user.passwordHash, undefined);
  ctx.owner = ok.body.token;
  const again = await request(app).post('/api/auth/setup').send({ setupToken: process.env.SETUP_TOKEN, name: 'X', phone: '9000000000', email: 'x@y.com', password: 'Owner@2026x' });
  assert.equal(again.status, 409);
});

test('login works with phone and email; wrong password locks after 5 attempts', async () => {
  const r1 = await request(app).post('/api/auth/login').send({ identifier: '9264289295', password: 'Owner@2026x' });
  assert.equal(r1.status, 200);
  const r2 = await request(app).post('/api/auth/login').send({ identifier: 'niteshkumar3850022@gmail.com', password: 'Owner@2026x' });
  assert.equal(r2.status, 200);
  // separate throwaway customer for lockout
  await request(app).post('/api/auth/register').send({ name: 'Lock Test', phone: '9111111111', password: 'Pass1234x' });
  for (let i = 0; i < 5; i += 1) await request(app).post('/api/auth/login').send({ identifier: '9111111111', password: 'wrong' });
  const locked = await request(app).post('/api/auth/login').send({ identifier: '9111111111', password: 'Pass1234x' });
  assert.equal(locked.status, 429);
});

test('stores: create 3 stores and a store manager limited to Store 1', async () => {
  const mk = (code, name, lat, lng, pins) => request(app).post('/api/stores').set(auth(ctx.owner)).send({
    code, name, address: { line1: 'Main Road', city: 'Chapra', district: 'Saran', pincode: pins[0] }, location: { lat, lng }, deliveryRadiusKm: 5, serviceablePincodes: pins, deliveryFee: 20,
  });
  const s1 = await mk('S1', 'Store 1', 25.78, 84.73, ['841301']);
  const s2 = await mk('S2', 'Store 2', 25.6, 85.1, ['800001']);
  const s3 = await mk('S3', 'Store 3', 26.1, 85.3, ['842001']);
  for (const s of [s1, s2, s3]) assert.equal(s.status, 201, JSON.stringify(s.body));
  ctx.s1 = s1.body._id;
  ctx.s2 = s2.body._id;
  ctx.s3 = s3.body._id;

  const mgr = await request(app).post('/api/users').set(auth(ctx.owner)).send({ name: 'Manager One', phone: '9222222222', password: 'Mgr12345x', role: 'store_manager', stores: [ctx.s1] });
  assert.equal(mgr.status, 201, JSON.stringify(mgr.body));
  ctx.mgr = (await request(app).post('/api/auth/login').send({ identifier: '9222222222', password: 'Mgr12345x' })).body.token;

  const visible = await request(app).get('/api/stores').set(auth(ctx.mgr));
  assert.deepEqual(visible.body.map((s) => s.code), ['S1']);
  const denied = await request(app).get(`/api/stores/${ctx.s2}`).set(auth(ctx.mgr));
  assert.equal(denied.status, 403);
  const noAdmin = await request(app).post('/api/users').set(auth(ctx.mgr)).send({ name: 'X', phone: '9333333333', password: 'Mgr12345x', role: 'central_admin', allStores: true });
  assert.equal(noAdmin.status, 403);
});

test('products: create with barcode, reject duplicate barcode, price above MRP rejected', async () => {
  const p = await request(app).post('/api/products').set(auth(ctx.owner)).send({ sku: 'TST-PARA-500', name: 'Test Paracetamol 500mg Tablet', barcodes: ['8900000000017'], mrp: 30, retailPrice: 27, gstRate: 12, unitsPerStrip: 10, stripsPerBox: 10 });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  ctx.para = p.body._id;
  const rx = await request(app).post('/api/products').set(auth(ctx.owner)).send({ sku: 'TST-RX-1', name: 'Test Antibiotic', mrp: 100, scheduleClass: 'H', gstRate: 12 });
  assert.equal(rx.status, 201);
  assert.equal(rx.body.prescriptionRequired, true);
  ctx.rx = rx.body._id;
  const dup = await request(app).post('/api/products').set(auth(ctx.owner)).send({ sku: 'TST-OTHER', name: 'Other', barcodes: ['8900000000017'], mrp: 10 });
  assert.equal(dup.status, 409);
  const above = await request(app).post('/api/products').set(auth(ctx.owner)).send({ sku: 'TST-BAD', name: 'Bad', mrp: 10, retailPrice: 12 });
  assert.equal(above.status, 400);
});

test('inventory: stock-in per store, isolation between stores, expired stock refused', async () => {
  const add = (store, batchNo, exp, qty) => request(app).post('/api/inventory/stock-in').set(auth(ctx.owner)).send({ storeId: store, productId: ctx.para, batchNo, expiryDate: exp, qty, mrp: 30, purchaseRate: 15 });
  assert.equal((await add(ctx.s1, 'B-LATE', day(400), 50)).status, 201);
  assert.equal((await add(ctx.s1, 'B-EARLY', day(100), 5)).status, 201);
  assert.equal((await add(ctx.s2, 'B-S2', day(300), 20)).status, 201);
  const rxIn = await request(app).post('/api/inventory/stock-in').set(auth(ctx.owner)).send({ storeId: ctx.s1, productId: ctx.rx, batchNo: 'RX1', expiryDate: day(300), qty: 10, mrp: 100, purchaseRate: 60 });
  assert.equal(rxIn.status, 201);

  const mgrStock = await request(app).get('/api/inventory/stock?storeId=all').set(auth(ctx.mgr));
  assert.ok(mgrStock.body.items.every((i) => i.store.code === 'S1'), 'manager sees only Store 1 stock');
  const forbidden = await request(app).get(`/api/inventory/stock?storeId=${ctx.s2}`).set(auth(ctx.mgr));
  assert.equal(forbidden.status, 403);

  const alerts = await request(app).get(`/api/inventory/alerts/expiry?storeId=${ctx.s1}&days=180`).set(auth(ctx.owner));
  assert.ok(alerts.body.items.some((b) => b.batchNo === 'B-EARLY'));
});

test('POS: shift, barcode scan with FEFO, sale reduces stock, unknown barcode warns, price override blocked', async () => {
  // POS operator in Store 1
  await request(app).post('/api/users').set(auth(ctx.owner)).send({ name: 'Cashier', phone: '9444444444', password: 'Cash1234x', role: 'pos_operator', stores: [ctx.s1] });
  ctx.cashier = (await request(app).post('/api/auth/login').send({ identifier: '9444444444', password: 'Cash1234x' })).body.token;

  const noShift = await request(app).post('/api/pos/sale').set(auth(ctx.cashier)).send({ storeId: ctx.s1, items: [{ productId: ctx.para, qty: 1 }], payment: { method: 'cash', cashTendered: 100 }, idempotencyKey: 'k-noshift-1' });
  assert.equal(noShift.status, 400);
  assert.equal((await request(app).post('/api/pos/shift/open').set(auth(ctx.cashier)).send({ storeId: ctx.s1, openingCash: 500 })).status, 201);

  const scan = await request(app).get(`/api/pos/scan?storeId=${ctx.s1}&code=8900000000017`).set(auth(ctx.cashier));
  assert.equal(scan.status, 200);
  assert.equal(scan.body.unitPrice, 27);
  assert.equal(scan.body.batches[0].batchNo, 'B-EARLY', 'FEFO: earliest expiry first');

  const unknown = await request(app).get(`/api/pos/scan?storeId=${ctx.s1}&code=1234567890123`).set(auth(ctx.cashier));
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.unknownBarcode, '1234567890123');

  const override = await request(app).post('/api/pos/sale').set(auth(ctx.cashier)).send({ storeId: ctx.s1, items: [{ productId: ctx.para, qty: 1, unitPrice: 10, overrideReason: 'x' }], payment: { method: 'cash', cashTendered: 100 }, idempotencyKey: 'k-override-1' });
  assert.equal(override.status, 403);

  const sale = await request(app).post('/api/pos/sale').set(auth(ctx.cashier)).send({ storeId: ctx.s1, items: [{ productId: ctx.para, qty: 4 }, { productId: ctx.para, qty: 3 }], payment: { method: 'cash', cashTendered: 200 }, idempotencyKey: 'k-sale-1' });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  assert.equal(sale.body.items.length, 1, 'duplicate scans merged into one line');
  assert.equal(sale.body.items[0].qty, 7);
  assert.equal(sale.body.grandTotal, 189);
  assert.equal(sale.body.payment.changeReturned, 11);
  const allocs = sale.body.items[0].allocations.map((a) => [a.batchNo, a.qty]);
  assert.deepEqual(allocs, [['B-EARLY', 5], ['B-LATE', 2]]);
  ctx.sale = sale.body;

  const replay = await request(app).post('/api/pos/sale').set(auth(ctx.cashier)).send({ storeId: ctx.s1, items: [{ productId: ctx.para, qty: 4 }, { productId: ctx.para, qty: 3 }], payment: { method: 'cash', cashTendered: 200 }, idempotencyKey: 'k-sale-1' });
  assert.equal(replay.body._id, sale.body._id, 'same idempotency key does not bill twice');

  const stock = await request(app).get(`/api/inventory/stock?storeId=${ctx.s1}`).set(auth(ctx.owner));
  const para = stock.body.items.find((i) => i.product.sku === 'TST-PARA-500');
  assert.equal(para.sellable, 48);

  const rxNoVerify = await request(app).post('/api/pos/sale').set(auth(ctx.cashier)).send({ storeId: ctx.s1, items: [{ productId: ctx.rx, qty: 1 }], payment: { method: 'cash', cashTendered: 100 }, idempotencyKey: 'k-rx-1' });
  assert.equal(rxNoVerify.status, 400, 'prescription medicine needs pharmacist verification');
});

test('stock: concurrent sales can never oversell', async () => {
  const p = await request(app).post('/api/products').set(auth(ctx.owner)).send({ sku: 'TST-SCARCE', name: 'Scarce Item', mrp: 10, gstRate: 0 });
  await request(app).post('/api/inventory/stock-in').set(auth(ctx.owner)).send({ storeId: ctx.s1, productId: p.body._id, batchNo: 'SC1', expiryDate: day(200), qty: 5, mrp: 10 });
  await request(app).post('/api/pos/shift/open').set(auth(ctx.owner)).send({ storeId: ctx.s1, openingCash: 0 });
  const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) => request(app).post('/api/pos/sale').set(auth(ctx.owner)).send({ storeId: ctx.s1, items: [{ productId: p.body._id, qty: 1 }], payment: { method: 'cash', cashTendered: 10 }, idempotencyKey: `k-race-${i}` })));
  const ok = attempts.filter((r) => r.status === 201).length;
  assert.equal(ok, 5, `exactly 5 sales should succeed, got ${ok}`);
  const batch = await mongoose.model('InventoryBatch').findOne({ batchNo: 'SC1' }).lean();
  assert.equal(batch.qtyAvailable, 0);
});

test('expired batch is never sold', async () => {
  const p = await request(app).post('/api/products').set(auth(ctx.owner)).send({ sku: 'TST-OLD', name: 'Old Stock', mrp: 10, gstRate: 0 });
  await mongoose.model('InventoryBatch').create({ store: ctx.s1, product: p.body._id, batchNo: 'EXP', expiryDate: day(-1), mrp: 10, qtyAvailable: 10, qtyReceived: 10 });
  const r = await request(app).post('/api/pos/sale').set(auth(ctx.owner)).send({ storeId: ctx.s1, items: [{ productId: p.body._id, qty: 1 }], payment: { method: 'cash', cashTendered: 10 }, idempotencyKey: 'k-exp-1' });
  assert.equal(r.status, 409);
});

test('transfers: dispatch from Store 1 and receive in Store 3 with the same batch and expiry', async () => {
  const t = await request(app).post('/api/transfers').set(auth(ctx.owner)).send({ fromStore: ctx.s1, toStore: ctx.s3, items: [{ product: ctx.para, qty: 10 }] });
  assert.equal(t.status, 201);
  const d = await request(app).post(`/api/transfers/${t.body._id}/dispatch`).set(auth(ctx.owner));
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const r = await request(app).post(`/api/transfers/${t.body._id}/receive`).set(auth(ctx.owner)).send({});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s3 = await mongoose.model('InventoryBatch').findOne({ store: ctx.s3, product: ctx.para }).lean();
  assert.equal(s3.batchNo, 'B-LATE');
  assert.equal(s3.qtyAvailable, 10);
});

test('online checkout: prescription required, reserved stock, pharmacist review, COD delivery with OTP', async () => {
  const reg = await request(app).post('/api/auth/register').send({ name: 'Ramesh', phone: '9555555555', password: 'Cust1234x' });
  ctx.cust = reg.body.token;
  const address = { name: 'Ramesh', phone: '9555555555', line1: 'Ward 5', city: 'Chapra', pincode: '841301' };

  const noRx = await request(app).post('/api/orders/checkout').set(auth(ctx.cust)).send({ items: [{ productId: ctx.rx, qty: 1 }], address, paymentMethod: 'cod', idempotencyKey: 'checkout-1' });
  assert.equal(noRx.status, 400);

  // upload prescription (tiny valid PNG)
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const up = await request(app).post('/api/prescriptions').set(auth(ctx.cust)).attach('files', png, { filename: 'rx.png', contentType: 'image/png' });
  assert.equal(up.status, 201, JSON.stringify(up.body));

  const order = await request(app).post('/api/orders/checkout').set(auth(ctx.cust)).send({ items: [{ productId: ctx.rx, qty: 2 }], address, paymentMethod: 'cod', prescriptionIds: [up.body._id], idempotencyKey: 'checkout-2' });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(order.body.status, 'prescription_review');
  assert.equal(order.body.deliveryFee, 20);
  const b = await mongoose.model('InventoryBatch').findOne({ store: ctx.s1, product: ctx.rx }).lean();
  assert.equal(b.qtyReserved, 2);
  assert.equal(b.qtyAvailable, 8);

  // cashier cannot review prescriptions
  const denied = await request(app).post(`/api/orders/${order.body._id}/prescription-review`).set(auth(ctx.cashier)).send({ decision: 'approve', notes: 'ok' });
  assert.equal(denied.status, 403);
  const approved = await request(app).post(`/api/orders/${order.body._id}/prescription-review`).set(auth(ctx.owner)).send({ decision: 'approve', notes: 'Valid prescription, checked' });
  assert.equal(approved.body.status, 'confirmed');

  for (const s of ['packing', 'ready_for_pickup']) {
    const r = await request(app).patch(`/api/orders/${order.body._id}/status`).set(auth(ctx.owner)).send({ status: s });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  // delivery partner
  const dp = await request(app).post('/api/users').set(auth(ctx.owner)).send({ name: 'Rider', phone: '9666666666', password: 'Ride1234x', role: 'delivery_partner', stores: [ctx.s1] });
  const notApproved = await request(app).post('/api/delivery/assign').set(auth(ctx.owner)).send({ orderId: order.body._id, partnerId: dp.body._id });
  assert.equal(notApproved.status, 400);
  await request(app).put(`/api/users/${dp.body._id}/delivery`).set(auth(ctx.owner)).send({ approved: true, ratePerDelivery: 30 });
  const asg = await request(app).post('/api/delivery/assign').set(auth(ctx.owner)).send({ orderId: order.body._id, partnerId: dp.body._id });
  assert.equal(asg.status, 201, JSON.stringify(asg.body));
  const rider = (await request(app).post('/api/auth/login').send({ identifier: '9666666666', password: 'Ride1234x' })).body.token;

  const custView = await request(app).get(`/api/orders/${order.body._id}`).set(auth(ctx.cust));
  const otp = custView.body.deliveryOtp;
  assert.match(otp, /^\d{4}$/);

  // location before pickup is not accepted
  const early = await request(app).post('/api/delivery/location').set(auth(rider)).send({ assignmentId: asg.body._id, lat: 25.78, lng: 84.73 });
  assert.equal(early.body.accepted, false);
  await request(app).post(`/api/delivery/assignments/${asg.body._id}/pickup`).set(auth(rider)).send({});
  await request(app).post(`/api/delivery/assignments/${asg.body._id}/out`).set(auth(rider));
  const loc = await request(app).post('/api/delivery/location').set(auth(rider)).send({ assignmentId: asg.body._id, lat: 25.781, lng: 84.735 });
  assert.equal(loc.body.accepted, true);
  const tracking = await request(app).get(`/api/orders/${order.body._id}`).set(auth(ctx.cust));
  assert.equal(tracking.body.liveLocation.lat, 25.781);

  const wrong = await request(app).post(`/api/delivery/assignments/${asg.body._id}/deliver`).set(auth(rider)).send({ otp: otp === '1111' ? '2222' : '1111', codCollected: order.body.grandTotal });
  assert.equal(wrong.status, 400);
  const done = await request(app).post(`/api/delivery/assignments/${asg.body._id}/deliver`).set(auth(rider)).send({ otp, codCollected: order.body.grandTotal });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const after = await mongoose.model('InventoryBatch').findOne({ store: ctx.s1, product: ctx.rx }).lean();
  assert.equal(after.qtyReserved, 0);
  assert.equal(after.qtyAvailable, 8);
  const stop = await request(app).post('/api/delivery/location').set(auth(rider)).send({ assignmentId: asg.body._id, lat: 25.78, lng: 84.73 });
  assert.equal(stop.body.stopTracking, true, 'location collection stops after delivery');
  ctx.onlineOrder = order.body._id;
});

test('cancellation releases reserved stock', async () => {
  const address = { name: 'Ramesh', phone: '9555555555', line1: 'Ward 5', city: 'Chapra', pincode: '841301' };
  const o = await request(app).post('/api/orders/checkout').set(auth(ctx.cust)).send({ items: [{ productId: ctx.para, qty: 3 }], address, paymentMethod: 'cod', idempotencyKey: 'checkout-cancel' });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const before = await mongoose.model('InventoryBatch').aggregate([{ $match: { store: new mongoose.Types.ObjectId(ctx.s1), product: new mongoose.Types.ObjectId(ctx.para) } }, { $group: { _id: null, r: { $sum: '$qtyReserved' } } }]);
  assert.equal(before[0].r, 3);
  const c = await request(app).post(`/api/orders/${o.body._id}/cancel`).set(auth(ctx.cust)).send({ reason: 'Ordered by mistake' });
  assert.equal(c.status, 200);
  const after = await mongoose.model('InventoryBatch').aggregate([{ $match: { store: new mongoose.Types.ObjectId(ctx.s1), product: new mongoose.Types.ObjectId(ctx.para) } }, { $group: { _id: null, r: { $sum: '$qtyReserved' } } }]);
  assert.equal(after[0].r, 0);
});

test('returns go to quarantine; refund needs a different approver', async () => {
  const itemId = ctx.sale.items[0]._id;
  const ret = await request(app).post(`/api/orders/${ctx.sale._id}/return`).set(auth(ctx.cashier)).send({ items: [{ itemId, qty: 2 }], reason: 'Customer returned sealed strips', refundMethod: 'cash' });
  assert.equal(ret.status, 200, JSON.stringify(ret.body));
  assert.ok(ret.body.refund);
  const q = await mongoose.model('InventoryBatch').findOne({ store: ctx.s1, product: ctx.para, qtyQuarantined: { $gt: 0 } }).lean();
  assert.equal(q.qtyQuarantined, 2);
  // cashier cannot approve
  const self = await request(app).post(`/api/refunds/${ret.body.refund._id}/approve`).set(auth(ctx.cashier)).send({ approvedAmount: 54 });
  assert.equal(self.status, 403);
  const appr = await request(app).post(`/api/refunds/${ret.body.refund._id}/approve`).set(auth(ctx.mgr)).send({ approvedAmount: 54 });
  assert.equal(appr.status, 200, JSON.stringify(appr.body));
  const cashOut = await request(app).post('/api/pos/cash-refund').set(auth(ctx.cashier)).send({ storeId: ctx.s1, amount: 54, refundId: ret.body.refund._id });
  assert.equal(cashOut.status, 200, JSON.stringify(cashOut.body));
});

test('payments: manual verification needs exact amount and unique bank reference', async () => {
  const address = { name: 'Ramesh', phone: '9555555555', line1: 'Ward 5', city: 'Chapra', pincode: '841301' };
  const o = await request(app).post('/api/orders/checkout').set(auth(ctx.cust)).send({ items: [{ productId: ctx.para, qty: 1 }], address, paymentMethod: 'cod', idempotencyKey: 'checkout-pay' });
  const bad = await request(app).post('/api/payments/manual-verify').set(auth(ctx.owner)).send({ orderId: o.body._id, amount: 1, reference: 'UTR000111', note: 'checked statement' });
  assert.equal(bad.status, 400);
  const ok = await request(app).post('/api/payments/manual-verify').set(auth(ctx.owner)).send({ orderId: o.body._id, amount: o.body.grandTotal, reference: 'UTR000111', note: 'checked statement' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.payment.status, 'paid');
  const cust = await request(app).post('/api/payments/manual-verify').set(auth(ctx.cust)).send({ orderId: o.body._id, amount: o.body.grandTotal, reference: 'UTR000222', note: 'I paid' });
  assert.equal(cust.status, 403, 'customers cannot mark orders paid');
});

test('PhonePe callback with a bad checksum is rejected', async () => {
  const r = await request(app).post('/api/payments/phonepe/callback').set('X-VERIFY', 'bad###1').send({ response: Buffer.from('{}').toString('base64') });
  assert.equal(r.status, 400);
});

test('reports: store and consolidated totals match (no double counting) and profit is correct', async () => {
  const all = await request(app).get(`/api/reports/dashboard?storeId=all&from=${day(-1)}&to=${day(1)}`).set(auth(ctx.owner));
  assert.equal(all.status, 200, JSON.stringify(all.body));
  const s1 = await request(app).get(`/api/reports/dashboard?storeId=${ctx.s1}&from=${day(-1)}&to=${day(1)}`).set(auth(ctx.owner));
  const s3 = await request(app).get(`/api/reports/dashboard?storeId=${ctx.s3}&from=${day(-1)}&to=${day(1)}`).set(auth(ctx.owner));
  assert.ok(Math.abs(all.body.summary.netSales - (s1.body.summary.netSales + s3.body.summary.netSales)) < 0.01, 'transfers are not sales; no double counting');
  assert.equal(s3.body.summary.orders, 0);
  assert.ok(all.body.summary.grossProfit > 0);
  assert.ok(Math.abs(all.body.summary.grossProfit - (all.body.summary.netRevenue - all.body.summary.cogs)) < 0.02);
  const mgrAll = await request(app).get('/api/reports/dashboard?storeId=all').set(auth(ctx.mgr));
  assert.equal(mgrAll.status, 200);
  const mgrS2 = await request(app).get(`/api/reports/dashboard?storeId=${ctx.s2}`).set(auth(ctx.mgr));
  assert.equal(mgrS2.status, 403);
  const cashierReports = await request(app).get('/api/reports/dashboard').set(auth(ctx.cashier));
  assert.equal(cashierReports.status, 403);
});

test('excel/csv import: preview with row errors, duplicates, confirm required for updates', async () => {
  const csv = 'sku,name,mrp,gst_rate\nIMP-1,Imported One,50,12\nIMP-1,Duplicate,50,12\nIMP-2,Bad MRP,abc,12\nTST-PARA-500,Renamed Para,30,12\n';
  const pv = await request(app).post('/api/io/preview/products').set(auth(ctx.owner)).attach('file', Buffer.from(csv), { filename: 'products.csv', contentType: 'text/csv' });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal(pv.body.validRows, 2);
  assert.equal(pv.body.errors.length, 2);
  assert.equal(pv.body.updates.length, 1);
  const commit = await request(app).post('/api/io/commit/products').set(auth(ctx.owner)).send({ token: pv.body.token });
  assert.equal(commit.body.created, 1);
  assert.equal(commit.body.skippedExisting, 1, 'existing product not changed without confirmation');
  const para = await mongoose.model('Product').findById(ctx.para).lean();
  assert.equal(para.name, 'Test Paracetamol 500mg Tablet');
  const exp = await request(app).get('/api/io/export/products?format=csv').set(auth(ctx.owner));
  assert.equal(exp.status, 200);
  assert.match(exp.text, /IMP-1/);
  const noExport = await request(app).get('/api/io/export/products').set(auth(ctx.cust));
  assert.equal(noExport.status, 403);
});

test('whatsapp webhook: signature enforced, incoming photo request recorded', async () => {
  const body = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Sita' } }], messages: [{ id: 'wamid.TEST1', from: '919777777777', type: 'text', text: { body: 'Need Dolo 650' } }] } }] }] });
  const unsigned = await request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').send(body);
  assert.equal(unsigned.status, 401);
  const sig = `sha256=${crypto.createHmac('sha256', 'wa-test-secret').update(body).digest('hex')}`;
  const signed = await request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(body);
  assert.equal(signed.status, 200);
  const reqs = await request(app).get('/api/medicine-requests').set(auth(ctx.owner));
  assert.ok(reqs.body.items.some((r) => r.source === 'whatsapp' && r.phone === '9777777777'));
});

test('employees: attendance and performance', async () => {
  const ci = await request(app).post('/api/employees/attendance/check-in').set(auth(ctx.cashier)).send({ storeId: ctx.s1 });
  assert.equal(ci.status, 200);
  const perf = await request(app).get(`/api/employees/performance?storeId=${ctx.s1}&from=${day(-1)}&to=${day(1)}`).set(auth(ctx.mgr));
  assert.equal(perf.status, 200);
  assert.ok(perf.body.some((p) => p.user.name === 'Cashier' && p.bills >= 1));
});

test('private files are not public', async () => {
  const pres = await mongoose.model('Prescription').findOne({}).lean();
  const name = pres.files[0].path;
  const anon = await request(app).get(`/uploads/public/${name}`);
  assert.equal(anon.status, 404);
  const other = await request(app).post('/api/auth/register').send({ name: 'Other', phone: '9888888888', password: 'Othr1234x' });
  const r = await request(app).get(`/api/files/${name}`).set(auth(other.body.token));
  assert.equal(r.status, 404);
  const owner = await request(app).get(`/api/files/${name}`).set(auth(ctx.cust));
  assert.equal(owner.status, 200);
});
