import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useApi, qs } from '../../lib/hooks';
import { inr, date, label, monthYear } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useAdminStore, useSingleStore } from '../../state/adminStore';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Field, Modal, PageHead, Pager, Status, Tabs } from '../../components/ui';
import { ProductPicker } from './Inventory';

const emptyLine = { product: null, purchaseUnit: 'box', orderedQty: '', freeQty: 0, rate: '', discountPercent: 0, gstRate: '', mrp: '', sellingPrice: '' };

function PurchaseForm({ onClose, onSaved }) {
  const toast = useToast();
  const { stores } = useAdminStore();
  const single = useSingleStore();
  const suppliers = useApi('/suppliers');
  const [f, setF] = useState({ storeId: single, supplier: '', kind: 'purchase_order', otherCharges: 0, supplierInvoiceNo: '', expectedDate: '', notes: '' });
  const [lines, setLines] = useState([{ ...emptyLine }]);
  const [calc, setCalc] = useState(null);
  const [error, setError] = useState(null);
  const valid = lines.filter((l) => l.product && Number(l.orderedQty) >= 0 && l.rate !== '');
  const toBody = (l) => ({ product: l.product._id, purchaseUnit: l.purchaseUnit, orderedQty: Number(l.orderedQty), freeQty: Number(l.freeQty || 0), rate: Number(l.rate), discountPercent: Number(l.discountPercent || 0), gstRate: l.gstRate === '' ? undefined : Number(l.gstRate), mrp: l.mrp === '' ? undefined : Number(l.mrp), sellingPrice: l.sellingPrice === '' ? undefined : Number(l.sellingPrice) });
  useEffect(() => {
    if (!valid.length) { setCalc(null); return undefined; }
    const t = setTimeout(() => api('/purchases/calculate', { method: 'POST', body: { items: valid.map(toBody), otherCharges: Number(f.otherCharges || 0) } }).then(setCalc).catch(() => {}), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(lines), f.otherCharges]);
  const setLine = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v, ...(k === 'product' && v ? { gstRate: v.gstRate ?? '', mrp: v.mrp ?? '', sellingPrice: v.price ?? '' } : {}) } : l)));
  const save = async (submit) => {
    try {
      await api('/purchases', { method: 'POST', body: { ...f, supplierInvoiceNo: f.supplierInvoiceNo || undefined, expectedDate: f.expectedDate || undefined, notes: f.notes || undefined, otherCharges: Number(f.otherCharges || 0), items: valid.map(toBody), submit } });
      toast(submit ? 'Purchase order placed' : 'Saved');
      onSaved();
    } catch (e) { setError(e); }
  };
  return (
    <Modal title="New purchase" onClose={onClose} wide>
      <div className="stack">
        <div className="form-grid">
          <Field label="Store"><select value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}>{stores.map((s) => <option key={s._id} value={s._id}>{s.code} · {s.name}</option>)}</select></Field>
          <Field label="Supplier"><select value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })}><option value="">Choose</option>{(suppliers.data || []).filter((s) => s.active).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select></Field>
          <Field label="Type"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="purchase_order">Purchase order</option><option value="quotation">Quotation request</option></select></Field>
          <Field label="Freight / other charges (₹)"><input type="number" value={f.otherCharges} onChange={(e) => setF({ ...f, otherCharges: e.target.value })} /></Field>
          <Field label="Supplier invoice no."><input value={f.supplierInvoiceNo} onChange={(e) => setF({ ...f, supplierInvoiceNo: e.target.value })} /></Field>
          <Field label="Expected delivery"><input type="date" value={f.expectedDate} onChange={(e) => setF({ ...f, expectedDate: e.target.value })} /></Field>
        </div>
        {lines.map((l, i) => {
          const c = calc?.lines?.[valid.indexOf(l)];
          return (
            <div key={i} className="panel tight stack">
              <div className="row" style={{ alignItems: 'end' }}>
                <div className="grow"><Field label={`Item ${i + 1}`}><ProductPicker value={l.product} onChange={(p) => setLine(i, 'product', p)} /></Field></div>
                <button className="linkbtn" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>
              </div>
              <div className="form-grid">
                <Field label="Buy in"><select value={l.purchaseUnit} onChange={(e) => setLine(i, 'purchaseUnit', e.target.value)}><option value="box">Boxes</option><option value="strip">Strips</option><option value="unit">Units</option></select></Field>
                <Field label="Paid qty"><input type="number" min="0" value={l.orderedQty} onChange={(e) => setLine(i, 'orderedQty', e.target.value)} /></Field>
                <Field label="Free qty (scheme)"><input type="number" min="0" value={l.freeQty} onChange={(e) => setLine(i, 'freeQty', e.target.value)} /></Field>
                <Field label={`Rate per ${l.purchaseUnit} (excl. GST)`}><input type="number" step="0.01" value={l.rate} onChange={(e) => setLine(i, 'rate', e.target.value)} /></Field>
                <Field label="Trade discount %"><input type="number" value={l.discountPercent} onChange={(e) => setLine(i, 'discountPercent', e.target.value)} /></Field>
                <Field label="GST %"><input type="number" value={l.gstRate} onChange={(e) => setLine(i, 'gstRate', e.target.value)} /></Field>
                <Field label="MRP per unit"><input type="number" step="0.01" value={l.mrp} onChange={(e) => setLine(i, 'mrp', e.target.value)} /></Field>
                <Field label="Selling price per unit"><input type="number" step="0.01" value={l.sellingPrice} onChange={(e) => setLine(i, 'sellingPrice', e.target.value)} /></Field>
              </div>
              {c && <small className="muted">{c.totalUnits} sellable units ({c.paidUnits} paid + {c.freeUnits} free) · taxable {inr(c.taxableAmount)} · GST {inr(c.gstAmount)} · landed cost/unit {inr(c.costPerUnit)} · margin/unit {inr(c.marginPerUnit)} ({c.marginPercent}%) · expected gross profit {inr(c.expectedGrossProfit)}</small>}
            </div>
          );
        })}
        <button className="btn ghost" onClick={() => setLines([...lines, { ...emptyLine }])}>Add item</button>
        {calc && <div className="notice">Invoice total {inr(calc.invoiceAmount + Number(f.otherCharges || 0))} · Taxable {inr(calc.taxableAmount)} · GST {inr(calc.gstAmount)} · {calc.totalUnits} units ({calc.freeUnits} free)</div>}
        <ErrorBox error={error} />
        <div className="row end"><button className="btn ghost" onClick={() => save(false)} disabled={!f.supplier || !valid.length}>Save draft</button><button className="btn" onClick={() => save(true)} disabled={!f.supplier || !valid.length}>{f.kind === 'quotation' ? 'Save quotation' : 'Place order'}</button></div>
      </div>
    </Modal>
  );
}

function PurchaseDetail({ id, onClose, onChanged }) {
  const toast = useToast();
  const { data, reload } = useApi(`/purchases/${id}`);
  const [tab, setTab] = useState('items');
  const [rcv, setRcv] = useState({});
  const [inv, setInv] = useState({ supplierInvoiceNo: '', supplierInvoiceDate: '' });
  const [pay, setPay] = useState({ amount: '', method: 'bank_transfer', reference: '' });
  if (!data) return null;
  const p = data.purchase;
  const receive = async () => {
    try {
      const lines = Object.entries(rcv).map(([product, v]) => ({ product, batchNo: v.batchNo, expiryDate: v.expiryDate, mfgDate: v.mfgDate || undefined, paidQty: Number(v.paidQty || 0), freeQty: Number(v.freeQty || 0), mrp: v.mrp ? Number(v.mrp) : undefined })).filter((l) => l.batchNo && (l.paidQty || l.freeQty));
      await api(`/purchases/${id}/receive`, { method: 'POST', body: { lines, supplierInvoiceNo: inv.supplierInvoiceNo || undefined, supplierInvoiceDate: inv.supplierInvoiceDate || undefined } });
      toast('Goods received into stock');
      setRcv({}); reload(); onChanged();
    } catch (e) { toast(e.message, 'error'); }
  };
  const addPayment = async () => {
    try { await api(`/purchases/${id}/payments`, { method: 'POST', body: { ...pay, amount: Number(pay.amount), reference: pay.reference || undefined } }); toast('Payment recorded'); reload(); onChanged(); } catch (e) { toast(e.message, 'error'); }
  };
  const submit = async () => { try { await api(`/purchases/${id}`, { method: 'PUT', body: { submit: true } }); reload(); onChanged(); } catch (e) { toast(e.message, 'error'); } };
  const cancel = async () => { try { await api(`/purchases/${id}/cancel`, { method: 'POST' }); reload(); onChanged(); } catch (e) { toast(e.message, 'error'); } };
  const upload = async (file) => { const fd = new FormData(); fd.append('file', file); try { await api(`/purchases/${id}/invoice-file`, { method: 'POST', form: fd }); toast('Invoice attached'); reload(); } catch (e) { toast(e.message, 'error'); } };
  const r = (pid, k) => (e) => setRcv({ ...rcv, [pid]: { ...(rcv[pid] || {}), [k]: e.target.value } });
  return (
    <Modal title={`${p.number} · ${p.supplier?.name}`} onClose={onClose} wide>
      <div className="row between"><span>{p.store?.name} · <Status value={p.status} /></span><span>Invoice {inr(p.totals?.invoiceAmount)} · Paid {inr(p.amountPaid)} · Returned {inr(p.amountReturned)} · <b>Outstanding {inr(p.outstanding)}</b></span></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'items', label: 'Items & pending' }, { value: 'receive', label: 'Receive goods' }, { value: 'payments', label: 'Payments' }, { value: 'grn', label: `Receipts (${data.receipts.length})` }]} />
      {tab === 'items' && (
        <>
          <DataTable rows={p.items} columns={[
            { title: 'Product', render: (i) => i.product?.name || i.productName }, { title: 'Unit', render: (i) => `${label(i.purchaseUnit)} (${i.unitsPerPack} units)` },
            { title: 'Paid ordered', key: 'orderedQty', num: true }, { title: 'Free', key: 'freeQty', num: true }, { title: 'Received', render: (i) => `${i.receivedQty} + ${i.receivedFreeQty} free`, num: true },
            { title: 'Pending', render: (i) => `${i.orderedQty - i.receivedQty} + ${i.freeQty - i.receivedFreeQty}`, num: true }, { title: 'Rate', render: (i) => inr(i.rate), num: true }, { title: 'GST', render: (i) => `${i.gstRate}%`, num: true },
          ]} />
          <div className="row" style={{ marginTop: 10 }}>
            {['draft', 'quotation'].includes(p.status) && <button className="btn" onClick={submit}>Confirm as purchase order</button>}
            {['draft', 'quotation', 'ordered'].includes(p.status) && <button className="btn ghost" onClick={cancel}>Cancel</button>}
            <label className="btn ghost">Attach supplier invoice<input type="file" hidden accept="image/*,application/pdf" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} /></label>
            {p.invoiceFile?.path && <span className="badge green">Invoice attached</span>}
          </div>
        </>
      )}
      {tab === 'receive' && (['ordered', 'partially_received'].includes(p.status) ? (
        <div className="stack">
          <div className="form-grid">
            <Field label="Supplier invoice no."><input value={inv.supplierInvoiceNo} onChange={(e) => setInv({ ...inv, supplierInvoiceNo: e.target.value })} /></Field>
            <Field label="Invoice date"><input type="date" value={inv.supplierInvoiceDate} onChange={(e) => setInv({ ...inv, supplierInvoiceDate: e.target.value })} /></Field>
          </div>
          {p.items.filter((i) => i.receivedQty < i.orderedQty || i.receivedFreeQty < i.freeQty).map((i) => {
            const pid = i.product?._id || i.product;
            return (
              <div key={pid} className="panel tight">
                <b>{i.product?.name || i.productName}</b> <small className="muted">pending {i.orderedQty - i.receivedQty} paid + {i.freeQty - i.receivedFreeQty} free ({label(i.purchaseUnit)})</small>
                <div className="form-grid">
                  <Field label="Batch no."><input value={rcv[pid]?.batchNo || ''} onChange={r(pid, 'batchNo')} /></Field>
                  <Field label="Expiry"><input type="month" value={rcv[pid]?.expiryDate || ''} onChange={r(pid, 'expiryDate')} /></Field>
                  <Field label="Mfg"><input type="month" value={rcv[pid]?.mfgDate || ''} onChange={r(pid, 'mfgDate')} /></Field>
                  <Field label="Paid qty received"><input type="number" min="0" value={rcv[pid]?.paidQty || ''} onChange={r(pid, 'paidQty')} /></Field>
                  <Field label="Free qty received"><input type="number" min="0" value={rcv[pid]?.freeQty || ''} onChange={r(pid, 'freeQty')} /></Field>
                  <Field label="MRP per unit"><input type="number" step="0.01" placeholder={i.mrp} value={rcv[pid]?.mrp || ''} onChange={r(pid, 'mrp')} /></Field>
                </div>
              </div>
            );
          })}
          <small className="muted">Receive each batch separately if one product arrives in several batches (submit, then enter the next batch).</small>
          <div className="row end"><button className="btn" onClick={receive}>Receive into stock</button></div>
        </div>
      ) : <p className="muted">Goods can be received once the purchase order is placed.</p>)}
      {tab === 'payments' && (
        <div className="stack">
          <DataTable rows={p.payments} empty="No payments yet." columns={[{ title: 'Date', render: (x) => date(x.date) }, { title: 'Method', render: (x) => label(x.method) }, { title: 'Reference', key: 'reference' }, { title: 'Amount', render: (x) => inr(x.amount), num: true }]} />
          <div className="form-grid">
            <Field label="Amount"><input type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
            <Field label="Method"><select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{['bank_transfer', 'upi', 'cheque', 'cash', 'card', 'other'].map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></Field>
            <Field label="Reference"><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
          </div>
          <div className="row end"><button className="btn" onClick={addPayment} disabled={!pay.amount}>Record payment</button></div>
        </div>
      )}
      {tab === 'grn' && data.receipts.map((g) => (
        <div key={g._id} className="panel tight"><b>{g.number}</b> · {date(g.createdAt)} · {g.receivedBy?.name}
          <ul>{g.items.map((it) => <li key={it.batch}>Batch {it.batchNo}, exp {monthYear(it.expiryDate)}: {it.units} units ({it.paidQty} paid + {it.freeQty} free) @ cost {inr(it.costPerUnit)}/unit</li>)}</ul>
        </div>
      ))}
    </Modal>
  );
}

function SupplierReturns({ storeId }) {
  const toast = useToast();
  const single = useSingleStore();
  const { data, reload } = useApi(`/purchases/returns/list${qs({ storeId })}`);
  const suppliers = useApi('/suppliers');
  const batches = useApi(`/inventory/batches${qs({ storeId: single, withStock: 'true', limit: 200 })}`);
  const [f, setF] = useState({ supplier: '', reason: 'expired', creditNoteNo: '' });
  const [items, setItems] = useState({});
  const submit = async () => {
    try {
      const list = Object.entries(items).filter(([, v]) => Number(v.qty) > 0).map(([batch, v]) => ({ batch, qty: Number(v.qty), from: v.from || 'available' }));
      await api('/purchases/returns', { method: 'POST', body: { storeId: single, ...f, creditNoteNo: f.creditNoteNo || undefined, items: list } });
      toast('Supplier return recorded');
      setItems({}); reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="stack">
      <DataTable rows={data} empty="No supplier returns." columns={[{ title: 'Number', key: 'number' }, { title: 'Store', render: (r) => r.store?.code }, { title: 'Supplier', render: (r) => r.supplier?.name }, { title: 'Reason', render: (r) => label(r.reason) }, { title: 'Value', render: (r) => inr(r.totalValue), num: true }, { title: 'Credit note', key: 'creditNoteNo' }, { title: 'Date', render: (r) => date(r.createdAt) }]} />
      <div className="panel stack">
        <h3>Return stock to a supplier</h3>
        <div className="form-grid">
          <Field label="Supplier"><select value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })}><option value="">Choose</option>{(suppliers.data || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select></Field>
          <Field label="Reason"><select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{['expired', 'near_expiry', 'damaged', 'recall', 'wrong_item', 'excess', 'other'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select></Field>
          <Field label="Credit note no."><input value={f.creditNoteNo} onChange={(e) => setF({ ...f, creditNoteNo: e.target.value })} /></Field>
        </div>
        <DataTable rows={batches.data?.items} columns={[
          { title: 'Product', render: (b) => b.product?.name }, { title: 'Batch', key: 'batchNo' }, { title: 'Exp', render: (b) => monthYear(b.expiryDate) },
          { title: 'Avail / Dmg / Quar', render: (b) => `${b.qtyAvailable} / ${b.qtyDamaged} / ${b.qtyQuarantined}` },
          { title: 'From', render: (b) => <select value={items[b._id]?.from || 'available'} onChange={(e) => setItems({ ...items, [b._id]: { ...(items[b._id] || {}), from: e.target.value } })} aria-label="From bucket"><option value="available">Available</option><option value="damaged">Damaged</option><option value="quarantined">Quarantined</option></select> },
          { title: 'Qty', render: (b) => <input type="number" min="0" style={{ width: 80 }} value={items[b._id]?.qty || ''} onChange={(e) => setItems({ ...items, [b._id]: { ...(items[b._id] || {}), qty: e.target.value } })} aria-label="Return qty" /> },
        ]} />
        <div className="row end"><button className="btn" onClick={submit} disabled={!f.supplier}>Record return</button></div>
      </div>
    </div>
  );
}

export default function Purchases() {
  const { can } = useAuth();
  const { storeId } = useAdminStore();
  const [tab, setTab] = useState('list');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, reload } = useApi(`/purchases${qs({ storeId, status, page })}`);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  return (
    <>
      <PageHead title="Purchases" sub="Quotations, purchase orders, goods receipts and supplier payments">{can('purchases.manage') && <button className="btn" onClick={() => setCreating(true)}>New purchase</button>}</PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'list', label: 'Purchases' }, { value: 'returns', label: 'Supplier returns' }]} />
      {tab === 'list' && (
        <>
          <div className="toolbar"><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{['draft', 'quotation', 'ordered', 'partially_received', 'received', 'cancelled'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
          <DataTable rows={data?.items} onRowClick={(p) => setOpen(p._id)} empty="No purchases yet." columns={[
            { title: 'Number', key: 'number' }, { title: 'Date', render: (p) => date(p.createdAt) }, { title: 'Store', render: (p) => p.store?.code }, { title: 'Supplier', render: (p) => p.supplier?.name },
            { title: 'Invoice', render: (p) => inr(p.totals?.invoiceAmount), num: true }, { title: 'Outstanding', render: (p) => inr(p.outstanding), num: true }, { title: 'Status', render: (p) => <Status value={p.status} /> },
          ]} />
          <Pager data={data} page={page} setPage={setPage} />
        </>
      )}
      {tab === 'returns' && <SupplierReturns storeId={storeId} />}
      {creating && <PurchaseForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
      {open && <PurchaseDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}
