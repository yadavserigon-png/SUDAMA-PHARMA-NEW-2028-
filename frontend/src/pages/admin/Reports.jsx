import { useState } from 'react';
import { download } from '../../lib/api';
import { useApi, qs } from '../../lib/hooks';
import { inr, num, today, label } from '../../lib/format';
import { useAdminStore } from '../../state/adminStore';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Kpi, Loading, PageHead, Field } from '../../components/ui';
import { Bars, LineChart } from '../../components/Charts';

const PRESETS = [['Today', 0], ['7 days', 6], ['30 days', 29], ['90 days', 89], ['This year', null]];

export default function Reports() {
  const { storeId } = useAdminStore();
  const toast = useToast();
  const [from, setFrom] = useState(today(-29));
  const [to, setTo] = useState(today());
  const [unit, setUnit] = useState('day');
  const [employee, setEmployee] = useState('');
  const staff = useApi(`/users?role=staff&limit=200${storeId !== 'all' ? `&storeId=${storeId}` : ''}`, [storeId]);
  const q = qs({ storeId, from, to, unit, employee });
  const { data: d, error, loading } = useApi(`/reports/dashboard${q}`, [q]);
  const preset = (days) => {
    setTo(today());
    if (days === null) { setFrom(`${today().slice(0, 4)}-01-01`); setUnit('month'); } else { setFrom(today(-days)); setUnit(days > 60 ? 'week' : 'day'); }
  };
  const fmtPeriod = (p) => new Date(p).toLocaleDateString('en-IN', unit === 'month' || unit === 'quarter' || unit === 'year' ? { month: 'short', year: '2-digit' } : { day: '2-digit', month: 'short' });
  return (
    <>
      <PageHead title="Sales & profit" sub={storeId === 'all' ? 'All stores, consolidated' : 'Selected store'}>
        <button className="btn secondary" onClick={() => download(`/reports/download${q}`, 'report.xlsx').catch((e) => toast(e.message, 'error'))}>Download Excel</button>
      </PageHead>
      <div className="toolbar">
        <div className="row">{PRESETS.map(([l, d2]) => <button key={l} className="btn ghost small" onClick={() => preset(d2)}>{l}</button>)}</div>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Group by">
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>{['day', 'week', 'month', 'quarter', 'year'].map((u) => <option key={u} value={u}>{label(u)}</option>)}</select>
        </Field>
        <Field label="Employee">
          <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
            <option value="">All employees</option>
            {(staff.data?.items || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
          </select>
        </Field>
      </div>
      <ErrorBox error={error} />
      {loading && !d && <Loading />}
      {d && (
        <div className="stack">
          <div className="kpis">
            <Kpi tone="accent" value={inr(d.summary.netSales)} label="Net sales (after returns, incl. GST)" />
            <Kpi value={inr(d.summary.netRevenue)} label="Net revenue (excl. GST)" />
            <Kpi value={inr(d.profitAndLoss.grossProfit)} label={`Gross profit · ${d.summary.grossMarginPercent}%`} />
            <Kpi tone={d.profitAndLoss.netOperatingResult < 0 ? 'warn' : ''} value={inr(d.profitAndLoss.netOperatingResult)} label="Net operating result" />
            <Kpi value={inr(d.cashFlow.netCashFlow)} label="Net cash flow" />
            <Kpi value={num(d.summary.orders)} label={`Bills · avg ${inr(d.summary.averageBill)}`} />
          </div>
          <div className="panel">
            <h3>Sales trend</h3>
            <LineChart labels={d.series.map((x) => fmtPeriod(x.period))} series={[
              { name: 'Online', color: '#23597a', values: d.series.map((x) => x.byChannel.online || 0) },
              { name: 'Counter', color: '#1f6f4a', values: d.series.map((x) => x.byChannel.pos || 0) },
              { name: 'Wholesale', color: '#d9930d', values: d.series.map((x) => x.byChannel.wholesale || 0) },
            ]} />
          </div>
          <div className="grid grid-2">
            <div className="panel">
              <h3>Profit &amp; loss</h3>
              <table><tbody>
                <tr><td>Net revenue (excl. GST)</td><td className="num">{inr(d.profitAndLoss.netRevenue)}</td></tr>
                <tr><td>Cost of goods sold (batch cost)</td><td className="num">− {inr(d.profitAndLoss.cogs)}</td></tr>
                <tr><th>Gross profit</th><th className="num">{inr(d.profitAndLoss.grossProfit)}</th></tr>
                <tr><td>Delivery fees earned (excl. GST, approx.)</td><td className="num">{inr(d.profitAndLoss.deliveryFeesExTax)}</td></tr>
                <tr><td>Operating expenses (approved)</td><td className="num">− {inr(d.profitAndLoss.operatingExpenses)}</td></tr>
                <tr><td>Delivery partner payouts</td><td className="num">− {inr(d.profitAndLoss.deliveryPartnerPayouts)}</td></tr>
                <tr><th>Net operating result</th><th className="num">{inr(d.profitAndLoss.netOperatingResult)}</th></tr>
              </tbody></table>
              <small className="muted">{d.profitAndLoss.note}</small>
            </div>
            <div className="panel">
              <h3>Cash flow</h3>
              <table><tbody>
                {d.cashFlow.receivedBy.map((r) => <tr key={r.provider}><td>Received · {label(r.provider)}</td><td className="num">{inr(r.amount)}</td></tr>)}
                <tr><td>Refunds paid</td><td className="num">− {inr(d.cashFlow.refundsPaid)}</td></tr>
                <tr><td>Expenses paid</td><td className="num">− {inr(d.cashFlow.expensesPaid)}</td></tr>
                <tr><td>Supplier payments</td><td className="num">− {inr(d.cashFlow.supplierPayments)}</td></tr>
                <tr><th>Net cash flow</th><th className="num">{inr(d.cashFlow.netCashFlow)}</th></tr>
              </tbody></table>
              <small className="muted">{d.cashFlow.note}</small>
            </div>
          </div>
          <div className="grid grid-3">
            {['online', 'pos', 'wholesale'].map((c) => (
              <div className="panel" key={c}>
                <h3>{c === 'pos' ? 'Counter (POS)' : label(c)}</h3>
                <p style={{ margin: 0 }}>{inr(d.channels[c].netSales)} · {d.channels[c].orders} orders</p>
                <small className="muted">Gross profit {inr(d.channels[c].grossProfit)}</small>
              </div>
            ))}
          </div>
          <div className="grid grid-2">
            <div className="panel"><h3>By store</h3><Bars rows={d.byStore.map((r) => ({ label: r.name || 'Store', value: r.netSales, sub: `GP ${inr(r.grossProfit)}` }))} /></div>
            <div className="panel"><h3>By employee (counter)</h3><Bars rows={d.byEmployee.map((r) => ({ label: r.name || '-', value: r.netSales }))} /></div>
            <div className="panel"><h3>Top products</h3><Bars rows={d.topProducts.map((r) => ({ label: r.name || '-', value: r.netSales, sub: `${r.units} units` }))} /></div>
            <div className="panel"><h3>By category</h3><Bars rows={d.byCategory.map((r) => ({ label: r.name || 'Uncategorised', value: r.netSales }))} /></div>
          </div>
          <div className="grid grid-3">
            <div className="panel"><h3>Discounts &amp; returns</h3>
              <p>Product discounts {inr(d.summary.productDiscount)}<br />Coupons {inr(d.summary.couponDiscount)}<br />Returns {inr(d.summary.returns)}<br />GST collected {inr(d.summary.gstCollected)}</p>
              <p className="muted">Refunds: {Object.entries(d.refunds).map(([k, v]) => `${label(k)} ${inr(v.amount)} (${v.count})`).join(', ') || 'none'}</p>
            </div>
            <div className="panel"><h3>Payment methods</h3><Bars rows={d.paymentMethods.map((p) => ({ label: label(p._id), value: p.amount, sub: `${p.orders}` }))} /></div>
            <div className="panel"><h3>Inventory</h3>
              <p>Stock at cost {inr(d.inventory.valueAtCost)}<br />Stock at MRP {inr(d.inventory.valueAtMrp)}<br />Expiring in 90 days {inr(d.inventory.expiring90Value)} ({d.inventory.expiring90Batches} batches)<br />Expired stock {inr(d.inventory.expiredValue)}</p>
            </div>
          </div>
          <div className="grid grid-2">
            <div className="panel"><h3>Operating expenses</h3><Bars rows={d.expenses.byCategory.map((e) => ({ label: label(e.category), value: e.amount }))} /></div>
            <div className="panel"><h3>Purchases &amp; supplier balances</h3>
              <p>Purchases this period {inr(d.purchases.invoiced)} ({d.purchases.count}) · Outstanding {inr(d.purchases.totalOutstanding)}</p>
              <DataTable rows={d.purchases.supplierBalances} empty="No outstanding balances." rowKey="_id" columns={[{ title: 'Supplier', key: 'name' }, { title: 'Outstanding', render: (r) => inr(r.outstanding), num: true }]} />
            </div>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem' }}>Revenue is counted when a bill is paid at the counter or an online order is delivered. "All stores" adds each store once; stock transfers are never counted as sales.</p>
        </div>
      )}
    </>
  );
}
