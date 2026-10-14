import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi, useDebounced, qs } from '../../lib/hooks';
import { inr, date, dateTime, label, monthYear } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useAdminStore, useSingleStore } from '../../state/adminStore';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Field, Modal, PageHead, Pager, Status, Tabs, Kpi } from '../../components/ui';

function ProductPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const res = useApi(dq.length > 1 ? `/products?q=${encodeURIComponent(dq)}&limit=10&includeInactive=true` : null);
  return (
    <div>
      <input placeholder="Search product by name / SKU / barcode" value={value ? value.name : q} onChange={(e) => { onChange(null); setQ(e.target.value); }} aria-label="Product" />
      {!value && res.data?.items?.length > 0 && (
        <div className="panel tight" style={{ maxHeight: 200, overflow: 'auto' }}>
          {res.data.items.map((p) => <div key={p._id}><button className="linkbtn" onClick={() => onChange(p)}>{p.name} · {p.sku}</button></div>)}
        </div>
      )}
    </div>
  );
}

function StockIn({ onDone, onClose }) {
  const toast = useToast();
  const { stores } = useAdminStore();
  const single = useSingleStore();
  const suppliers = useApi('/suppliers');
  const [product, setProduct] = useState(null);
  const [f, setF] = useState({ storeId: single, batchNo: '', expiryDate: '', mfgDate: '', qty: '', mrp: '', purchaseRate: '', supplier: '', source: 'opening', note: '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      await api('/inventory/stock-in', { method: 'POST', body: { ...f, productId: product?._id, qty: Number(f.qty), mrp: Number(f.mrp), purchaseRate: f.purchaseRate ? Number(f.purchaseRate) : undefined, supplier: f.supplier || undefined, mfgDate: f.mfgDate || undefined, note: f.note || undefined } });
      toast('Stock added');
      onDone();
    } catch (e) { setError(e); }
  };
  return (
    <Modal title="Add stock (opening stock / manual receipt)" onClose={onClose}>
      <p className="muted">For supplier deliveries use Purchases → Receive goods so costs and supplier balances stay correct.</p>
      <div className="stack">
        <Field label="Store"><select value={f.storeId} onChange={set('storeId')}>{stores.map((s) => <option key={s._id} value={s._id}>{s.code} · {s.name}</option>)}</select></Field>
        <Field label="Product"><ProductPicker value={product} onChange={setProduct} /></Field>
        <div className="form-grid">
          <Field label="Batch no."><input value={f.batchNo} onChange={set('batchNo')} /></Field>
          <Field label="Expiry" hint="as on pack"><input type="month" value={f.expiryDate} onChange={set('expiryDate')} /></Field>
          <Field label="Mfg date"><input type="month" value={f.mfgDate} onChange={set('mfgDate')} /></Field>
          <Field label="Quantity (sellable units)"><input type="number" min="1" value={f.qty} onChange={set('qty')} /></Field>
          <Field label="MRP per unit (₹)"><input type="number" step="0.01" value={f.mrp} onChange={set('mrp')} /></Field>
          <Field label="Cost per unit (₹, excl. GST)"><input type="number" step="0.01" value={f.purchaseRate} onChange={set('purchaseRate')} /></Field>
          <Field label="Supplier"><select value={f.supplier} onChange={set('supplier')}><option value="">-</option>{(suppliers.data || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select></Field>
          <Field label="Type"><select value={f.source} onChange={set('source')}><option value="opening">Opening stock</option><option value="adjustment">Found in count</option></select></Field>
        </div>
        <Field label="Note"><input value={f.note} onChange={set('note')} /></Field>
        <ErrorBox error={error} />
        <div className="row end"><button className="btn" onClick={save} disabled={!product}>Add stock</button></div>
      </div>
    </Modal>
  );
}

function BatchActions({ batch, onDone, onClose }) {
  const toast = useToast();
  const [mode, setMode] = useState('adjust');
  const [f, setF] = useState({ delta: '', type: 'damage', reason: '', status: batch.status, restockQty: 0, damagedQty: 0 });
  const [error, setError] = useState(null);
  const run = async () => {
    try {
      if (mode === 'adjust') await api(`/inventory/batches/${batch._id}/adjust`, { method: 'POST', body: { delta: Number(f.delta), type: f.type, reason: f.reason } });
      if (mode === 'status') await api(`/inventory/batches/${batch._id}/status`, { method: 'POST', body: { status: f.status, reason: f.reason } });
      if (mode === 'inspect') await api(`/inventory/batches/${batch._id}/inspect`, { method: 'POST', body: { restockQty: Number(f.restockQty), damagedQty: Number(f.damagedQty), note: f.reason } });
      toast('Saved');
      onDone();
    } catch (e) { setError(e); }
  };
  return (
    <Modal title={`Batch ${batch.batchNo} · ${batch.product?.name}`} onClose={onClose}>
      <p className="muted">Available {batch.qtyAvailable} · Reserved {batch.qtyReserved} · Quarantined {batch.qtyQuarantined} · Damaged {batch.qtyDamaged} · Expiry {monthYear(batch.expiryDate)}</p>
      <Tabs value={mode} onChange={setMode} tabs={[{ value: 'adjust', label: 'Adjust / damage' }, { value: 'status', label: 'Block / recall' }, { value: 'inspect', label: `Inspect returns (${batch.qtyQuarantined})` }]} />
      <div className="stack">
        {mode === 'adjust' && (
          <div className="form-grid">
            <Field label="Type"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="damage">Damaged / broken</option><option value="adjustment">Correction</option></select></Field>
            <Field label="Change in quantity" hint="negative to reduce"><input type="number" value={f.delta} onChange={(e) => setF({ ...f, delta: e.target.value })} /></Field>
          </div>
        )}
        {mode === 'status' && (
          <Field label="Batch status"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">Active (sellable)</option><option value="quarantined">Quarantined</option><option value="blocked">Blocked</option><option value="recalled">Recalled by manufacturer</option></select></Field>
        )}
        {mode === 'inspect' && (
          <div className="form-grid">
            <Field label="Units OK to sell again"><input type="number" min="0" value={f.restockQty} onChange={(e) => setF({ ...f, restockQty: e.target.value })} /></Field>
            <Field label="Units damaged"><input type="number" min="0" value={f.damagedQty} onChange={(e) => setF({ ...f, damagedQty: e.target.value })} /></Field>
          </div>
        )}
        <Field label={mode === 'inspect' ? 'Inspection note' : 'Reason'}><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <ErrorBox error={error} />
        <div className="row end"><button className="btn" onClick={run}>Save</button></div>
      </div>
    </Modal>
  );
}

function StockTab({ storeId }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const dq = useDebounced(q);
  const { data, error } = useApi(`/inventory/stock${qs({ storeId, q: dq, status })}`);
  const val = useApi(`/inventory/valuation${qs({ storeId })}`);
  return (
    <>
      {val.data && <div className="kpis" style={{ marginBottom: 14 }}><Kpi value={inr(val.data.total.costValue)} label="Sellable stock at cost" /><Kpi value={inr(val.data.total.mrpValue)} label="Sellable stock at MRP" /><Kpi value={val.data.total.units} label="Sellable units" /></div>}
      <div className="toolbar">
        <input placeholder="Search product" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All</option><option value="in_stock">In stock</option><option value="low_stock">Low</option><option value="out_of_stock">Out</option></select>
      </div>
      <ErrorBox error={error} />
      <DataTable rows={data?.items} rowKey="id" empty="No stock recorded yet." columns={[
        { title: 'Store', render: (r) => r.store.code },
        { title: 'Product', render: (r) => <>{r.product.name}<br /><small className="muted">{r.product.sku}</small></> },
        { title: 'Sellable', key: 'sellable', num: true }, { title: 'Reserved', key: 'reserved', num: true }, { title: 'Quarantine', key: 'quarantined', num: true }, { title: 'Damaged', key: 'damaged', num: true },
        { title: 'Value (cost)', render: (r) => inr(r.costValue), num: true }, { title: 'Nearest expiry', render: (r) => monthYear(r.nearestExpiry) }, { title: 'Status', render: (r) => <Status value={r.status} /> },
      ]} />
    </>
  );
}

function BatchesTab({ storeId, canManage }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const dq = useDebounced(q);
  const { data, reload } = useApi(`/inventory/batches${qs({ storeId, q: dq, status, page, withStock: 'true' })}`);
  const [sel, setSel] = useState(null);
  return (
    <>
      <div className="toolbar">
        <input placeholder="Search product" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Batch status"><option value="">Any status</option><option value="active">Active</option><option value="quarantined">Quarantined</option><option value="blocked">Blocked</option><option value="recalled">Recalled</option></select>
      </div>
      <DataTable rows={data?.items} onRowClick={canManage ? setSel : undefined} columns={[
        { title: 'Store', render: (b) => b.store?.code }, { title: 'Product', render: (b) => b.product?.name }, { title: 'Batch', key: 'batchNo' },
        { title: 'Expiry', render: (b) => monthYear(b.expiryDate) }, { title: 'MRP', render: (b) => inr(b.mrp), num: true }, { title: 'Cost/unit', render: (b) => inr(b.costPerUnit), num: true },
        { title: 'Avail.', key: 'qtyAvailable', num: true }, { title: 'Res.', key: 'qtyReserved', num: true }, { title: 'Quar.', key: 'qtyQuarantined', num: true }, { title: 'Dmg.', key: 'qtyDamaged', num: true },
        { title: 'Supplier', render: (b) => b.supplier?.name }, { title: 'Status', render: (b) => <Status value={b.status} /> },
      ]} />
      <Pager data={data} page={page} setPage={setPage} />
      {sel && <BatchActions batch={sel} onClose={() => setSel(null)} onDone={() => { setSel(null); reload(); }} />}
    </>
  );
}

function ExpiryTab({ storeId }) {
  const [days, setDays] = useState(90);
  const { data } = useApi(`/inventory/alerts/expiry${qs({ storeId, days })}`);
  return (
    <>
      <div className="toolbar">
        <Field label="Show batches expiring within">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}</select>
        </Field>
        {data && <span className="muted">{Object.entries(data.summary).map(([k, v]) => `${label(k)}: ${v}`).join(' · ')}</span>}
      </div>
      <DataTable rows={data?.items} empty="Nothing expiring in this window." columns={[
        { title: 'Store', render: (b) => b.store?.code }, { title: 'Product', render: (b) => b.product?.name }, { title: 'Batch', key: 'batchNo' }, { title: 'Expiry', render: (b) => date(b.expiryDate) },
        { title: 'Days left', render: (b) => (b.days <= 0 ? <span className="badge red">Expired</span> : b.days), num: true }, { title: 'Qty', render: (b) => b.qtyAvailable + b.qtyReserved, num: true },
        { title: 'Value at cost', render: (b) => inr(b.valueAtCost), num: true }, { title: 'Supplier', render: (b) => (b.supplier ? `${b.supplier.name} ${b.supplier.phone || ''}` : '') },
      ]} />
      <p className="muted" style={{ fontSize: '0.85rem' }}>Expired batches are blocked from sale automatically. Return them to the supplier from Purchases → Supplier returns.</p>
    </>
  );
}

function LowTab({ storeId }) {
  const { data } = useApi(`/inventory/alerts/low-stock${qs({ storeId })}`);
  const cols = [{ title: 'Store', render: (r) => r.store.code }, { title: 'Product', render: (r) => r.product.name }, { title: 'SKU', render: (r) => r.product.sku }, { title: 'Sellable', key: 'sellable', num: true }, { title: 'Alert level', render: (r) => r.product.lowStockThreshold, num: true }];
  return (
    <div className="grid grid-2">
      <div><h3>Out of stock</h3><DataTable rows={data?.outOfStock} rowKey="_id" columns={cols} empty="Nothing out of stock." /></div>
      <div><h3>Low stock</h3><DataTable rows={data?.lowStock} rowKey="_id" columns={cols} empty="Nothing running low." /></div>
    </div>
  );
}

function AnalysisTab({ storeId }) {
  const [days, setDays] = useState(30);
  const { data } = useApi(`/inventory/analysis${qs({ storeId, days })}`);
  const cols = [{ title: 'Product', key: 'name' }, { title: 'Stock', key: 'stockQty', num: true }, { title: 'Sold', key: 'soldInWindow', num: true }, { title: 'Days of cover', render: (r) => r.daysOfCover ?? '-', num: true }, { title: 'Stock value', render: (r) => inr(r.stockValue), num: true }, { title: 'Last sold', render: (r) => date(r.lastSold) }];
  return (
    <div className="stack">
      <Field label="Sales window"><select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}</select></Field>
      <h3>Fast moving</h3><DataTable rows={data?.fastMoving} rowKey="product" columns={cols} />
      <h3>Slow moving</h3><DataTable rows={data?.slowMoving} rowKey="product" columns={cols} />
      <h3>Dead stock (no sale in {data?.deadDays} days)</h3><DataTable rows={data?.deadStock} rowKey="product" columns={cols} />
    </div>
  );
}

function MovementsTab({ storeId }) {
  const [batchNo, setBatchNo] = useState('');
  const [page, setPage] = useState(1);
  const db = useDebounced(batchNo);
  const { data } = useApi(`/inventory/movements${qs({ storeId, batchNo: db, page })}`);
  return (
    <>
      <div className="toolbar"><input placeholder="Trace a batch number" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} aria-label="Batch number" /></div>
      <DataTable rows={data?.items} columns={[
        { title: 'When', render: (m) => dateTime(m.createdAt) }, { title: 'Store', render: (m) => m.store?.code }, { title: 'Product', render: (m) => m.product?.name }, { title: 'Batch', key: 'batchNo' },
        { title: 'Type', render: (m) => label(m.type) }, { title: 'Qty', render: (m) => (m.qty > 0 ? `+${m.qty}` : m.qty), num: true }, { title: 'By', render: (m) => m.user?.name }, { title: 'Note', key: 'note' },
      ]} />
      <Pager data={data} page={page} setPage={setPage} />
    </>
  );
}

function CountsTab({ storeId, canManage }) {
  const toast = useToast();
  const single = useSingleStore();
  const { data, reload } = useApi(`/inventory/counts${qs({ storeId })}`);
  const [open, setOpen] = useState(null);
  const [counts, setCounts] = useState({});
  const start = async () => {
    try { const c = await api('/inventory/counts', { method: 'POST', body: { storeId: single } }); toast(`Count ${c.number} started`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const view = async (c) => { setOpen(await api(`/inventory/counts/${c._id}`)); setCounts({}); };
  const save = async (submit) => {
    try {
      const lines = Object.entries(counts).map(([lineId, v]) => ({ lineId, countedQty: Number(v) }));
      await api(`/inventory/counts/${open._id}`, { method: 'PUT', body: { lines, submit } });
      toast(submit ? 'Submitted for approval' : 'Saved');
      setOpen(null);
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  const approve = async (c) => {
    try { const r = await api(`/inventory/counts/${c._id}/approve`, { method: 'POST' }); toast(`Applied ${r.applied.length} corrections`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      {canManage && <button className="btn" onClick={start} disabled={!single} style={{ marginBottom: 12 }}>Start a physical count for {storeId === 'all' ? 'the first store' : 'this store'}</button>}
      <DataTable rows={data} columns={[
        { title: 'Count', key: 'number' }, { title: 'Store', render: (c) => c.store?.code }, { title: 'Started', render: (c) => dateTime(c.createdAt) }, { title: 'By', render: (c) => c.createdBy?.name },
        { title: 'Status', render: (c) => <Status value={c.status} /> },
        { title: '', render: (c) => <span className="row">{c.status === 'open' && <button className="btn small" onClick={() => view(c)}>Enter counts</button>}{c.status === 'submitted' && canManage && <button className="btn small" onClick={() => approve(c)}>Approve &amp; apply</button>}</span> },
      ]} />
      {open && (
        <Modal title={`Count ${open.number}`} onClose={() => setOpen(null)} wide>
          <p className="muted">Count physical units on the shelf, including units kept aside for online orders. A different authorised person approves the variances.</p>
          <DataTable rows={open.lines} columns={[
            { title: 'Product', render: (l) => l.product?.name }, { title: 'Batch', key: 'batchNo' }, { title: 'System qty', key: 'systemQty', num: true },
            { title: 'Counted', render: (l) => <input type="number" min="0" style={{ width: 90 }} defaultValue={l.countedQty ?? ''} onChange={(e) => setCounts({ ...counts, [l._id]: e.target.value })} aria-label={`Counted ${l.batchNo}`} /> },
          ]} />
          <div className="row end" style={{ marginTop: 12 }}><button className="btn ghost" onClick={() => save(false)}>Save draft</button><button className="btn" onClick={() => save(true)}>Submit</button></div>
        </Modal>
      )}
    </>
  );
}

export default function Inventory() {
  const { can } = useAuth();
  const { storeId } = useAdminStore();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'stock';
  const [stockIn, setStockIn] = useState(false);
  const [key, setKey] = useState(0);
  const canManage = can('inventory.manage');
  return (
    <>
      <PageHead title="Inventory & expiry" sub="Batch-level stock for every store">
        {canManage && <button className="btn" onClick={() => setStockIn(true)}>Add stock</button>}
      </PageHead>
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { value: 'stock', label: 'Stock' }, { value: 'batches', label: 'Batches' }, { value: 'expiry', label: 'Expiry alerts' }, { value: 'low', label: 'Low / out of stock' },
        { value: 'analysis', label: 'Fast / slow / dead' }, { value: 'movements', label: 'Stock ledger' }, { value: 'counts', label: 'Physical counts' },
      ]} />
      <div key={key}>
        {tab === 'stock' && <StockTab storeId={storeId} />}
        {tab === 'batches' && <BatchesTab storeId={storeId} canManage={canManage} />}
        {tab === 'expiry' && <ExpiryTab storeId={storeId} />}
        {tab === 'low' && <LowTab storeId={storeId} />}
        {tab === 'analysis' && <AnalysisTab storeId={storeId} />}
        {tab === 'movements' && <MovementsTab storeId={storeId} />}
        {tab === 'counts' && <CountsTab storeId={storeId} canManage={canManage} />}
      </div>
      {stockIn && <StockIn onClose={() => setStockIn(false)} onDone={() => { setStockIn(false); setKey((k) => k + 1); }} />}
    </>
  );
}

export { ProductPicker };
