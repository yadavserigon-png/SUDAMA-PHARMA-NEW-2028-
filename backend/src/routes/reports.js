const express = require('express');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { parseRange } = require('../utils/dates');
const { authenticate, requirePermission } = require('../middleware/auth');
const { storeFilter } = require('../middleware/storeScope');
const reports = require('../services/reports');

const router = express.Router();
router.use(authenticate, requirePermission('reports.view'));

function scope(req) {
  const sf = storeFilter(req);
  const { from, to } = parseRange(req.query);
  const unit = ['day', 'week', 'month', 'quarter', 'year'].includes(req.query.unit) ? req.query.unit : 'day';
  const extra = {};
  if (req.query.employee && mongoose.isValidObjectId(req.query.employee)) extra.cashier = new mongoose.Types.ObjectId(req.query.employee);
  return { sf, orderFilter: extra, from, to, unit };
}

router.get('/dashboard', ah(async (req, res) => {
  const { sf, orderFilter, from, to, unit } = scope(req);
  res.json(await reports.dashboard(sf, from, to, { unit, orderFilter }));
}));

// Store comparison for "All Stores"
router.get('/compare', ah(async (req, res) => {
  const { sf, from, to } = scope(req);
  const byStore = await reports.breakdown(sf, from, to, '$store', { lookup: { from: 'stores', field: 'name' } });
  res.json({ from, to, stores: byStore });
}));

function addSheet(wb, name, rows, columns) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 18 }));
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  return ws;
}

router.get('/download', ah(async (req, res) => {
  const { sf, orderFilter, from, to, unit } = scope(req);
  const d = await reports.dashboard(sf, from, to, { unit, orderFilter });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sudama Pharma';
  addSheet(wb, 'Summary', [
    ...Object.entries(d.summary).map(([k, v]) => ({ metric: k, value: v })),
    ...Object.entries(d.profitAndLoss).filter(([k]) => k !== 'note').map(([k, v]) => ({ metric: `P&L ${k}`, value: v })),
    ...Object.entries(d.cashFlow).filter(([k]) => !['note', 'receivedBy'].includes(k)).map(([k, v]) => ({ metric: `Cash ${k}`, value: v })),
    ...Object.entries(d.inventory).map(([k, v]) => ({ metric: `Inventory ${k}`, value: v })),
  ], [{ header: 'Metric', key: 'metric', width: 32 }, { header: 'Value', key: 'value' }]);
  addSheet(wb, `Sales by ${unit}`, d.series.map((s) => ({ period: new Date(s.period).toISOString().slice(0, 10), netSales: s.netSales, grossProfit: s.grossProfit, online: s.byChannel.online || 0, pos: s.byChannel.pos || 0, wholesale: s.byChannel.wholesale || 0 })),
    [{ header: 'Period', key: 'period' }, { header: 'Net sales', key: 'netSales' }, { header: 'Gross profit', key: 'grossProfit' }, { header: 'Online', key: 'online' }, { header: 'Counter', key: 'pos' }, { header: 'Wholesale', key: 'wholesale' }]);
  const bcols = [{ header: 'Name', key: 'name', width: 30 }, { header: 'Orders', key: 'orders' }, { header: 'Units', key: 'units' }, { header: 'Net sales', key: 'netSales' }, { header: 'Net revenue', key: 'netRevenue' }, { header: 'COGS', key: 'cogs' }, { header: 'Gross profit', key: 'grossProfit' }];
  addSheet(wb, 'By store', d.byStore, bcols);
  addSheet(wb, 'By employee', d.byEmployee, bcols);
  addSheet(wb, 'Top products', d.topProducts, bcols);
  addSheet(wb, 'By category', d.byCategory, bcols);
  addSheet(wb, 'Payment methods', d.paymentMethods.map((p) => ({ method: p._id, amount: p.amount, orders: p.orders })), [{ header: 'Method', key: 'method' }, { header: 'Amount', key: 'amount' }, { header: 'Orders', key: 'orders' }]);
  addSheet(wb, 'Expenses', d.expenses.byCategory, [{ header: 'Category', key: 'category' }, { header: 'Amount', key: 'amount' }]);
  addSheet(wb, 'Supplier balances', d.purchases.supplierBalances, [{ header: 'Supplier', key: 'name', width: 30 }, { header: 'Invoiced', key: 'invoiced' }, { header: 'Paid', key: 'paid' }, { header: 'Outstanding', key: 'outstanding' }]);
  await audit(req, 'report.downloaded', 'Report', 'dashboard', { from, to, storeId: req.query.storeId || 'all' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="sudama-report-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

module.exports = router;
