import { useState } from 'react';
import { api, openProtected, fileUrl, download } from '../../lib/api';
import { useApi, qs } from '../../lib/hooks';
import { inr, date, dateTime, label, today } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useAdminStore, useSingleStore } from '../../state/adminStore';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Field, Modal, PageHead, Pager, Status, Tabs } from '../../components/ui';

export function Payments() {
  const { storeId } = useAdminStore();
  const [tab, setTab] = useState('list');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState(today(-29));
  const [to, setTo] = useState(today());
  const list = useApi(`/payments${qs({ storeId, status, page, from, to })}`);
  const rec = useApi(tab === 'rec' ? `/payments/reconciliation${qs({ storeId, from, to })}` : null);
  const settings = useApi('/settings/payments');
  return (
    <>
      <PageHead title="Payments" sub="Every payment is verified on the server - never from a screenshot or redirect" />
      {settings.data && <div className={`notice ${settings.data.gateway.phonepeConfigured ? '' : 'warn'}`} style={{ marginBottom: 12 }}>PhonePe gateway: {settings.data.gateway.phonepeConfigured ? `configured (${settings.data.gateway.phonepeEnv})` : 'not configured - add merchant credentials to the backend .env after onboarding'} · UPI ID: {settings.data.value.upiVerified ? settings.data.value.upiId : 'not verified yet'}</div>}
      <div className="toolbar"><Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'list', label: 'Transactions' }, { value: 'rec', label: 'Reconciliation' }]} />
      {tab === 'list' && (
        <>
          <select style={{ maxWidth: 200, marginBottom: 10 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All</option>{['success', 'pending', 'created', 'failed', 'refunded'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
          <DataTable rows={list.data?.items} columns={[
            { title: 'When', render: (p) => dateTime(p.createdAt) }, { title: 'Order', render: (p) => p.order?.orderNumber }, { title: 'Store', render: (p) => p.store?.code },
            { title: 'Provider', render: (p) => label(p.provider) }, { title: 'Reference', render: (p) => p.providerReference || p.merchantTransactionId }, { title: 'Amount', render: (p) => inr(p.amount), num: true },
            { title: 'Verified by', render: (p) => (p.verifiedBy ? `${label(p.verifiedBy)}${p.verifiedByUser ? ` (${p.verifiedByUser.name})` : ''}` : '') }, { title: 'Status', render: (p) => <Status value={p.status} /> },
          ]} />
          <Pager data={list.data} page={page} setPage={setPage} />
        </>
      )}
      {tab === 'rec' && rec.data && (
        <div className="stack">
          <DataTable rows={rec.data.byProvider} rowKey="x" columns={[{ title: 'Provider', render: (r) => label(r._id.provider) }, { title: 'Status', render: (r) => <Status value={r._id.status} /> }, { title: 'Count', key: 'count', num: true }, { title: 'Amount', render: (r) => inr(r.amount), num: true }]} />
          <h3>Paid orders with no payment record ({rec.data.issues.paidOrdersWithoutPayment.length})</h3>
          <DataTable rows={rec.data.issues.paidOrdersWithoutPayment} empty="None." columns={[{ title: 'Order', key: 'orderNumber' }, { title: 'Channel', key: 'channel' }, { title: 'Total', render: (o) => inr(o.grandTotal), num: true }]} />
          <h3>Successful payments on unpaid orders ({rec.data.issues.successPaymentsOrderUnpaid.length})</h3>
          <DataTable rows={rec.data.issues.successPaymentsOrderUnpaid} empty="None." columns={[{ title: 'Order', render: (p) => p.o?.orderNumber }, { title: 'Provider', key: 'provider' }, { title: 'Amount', render: (p) => inr(p.amount), num: true }]} />
          <h3>Payments pending for more than 30 minutes ({rec.data.issues.stalePendingPayments.length})</h3>
          <DataTable rows={rec.data.issues.stalePendingPayments} empty="None." columns={[{ title: 'Order', render: (p) => p.order?.orderNumber }, { title: 'Txn', key: 'merchantTransactionId' }, { title: 'Amount', render: (p) => inr(p.amount), num: true }, { title: 'Since', render: (p) => dateTime(p.createdAt) }]} />
        </div>
      )}
    </>
  );
}

export function Refunds() {
  const { can } = useAuth();
  const { storeId } = useAdminStore();
  const toast = useToast();
  const [status, setStatus] = useState('requested');
  const { data, reload } = useApi(`/refunds${qs({ storeId, status })}`);
  const [sel, setSel] = useState(null);
  const [f, setF] = useState({});
  const act = async (path, body, msg) => { try { await api(`/refunds/${sel._id}/${path}`, { method: 'POST', body }); toast(msg); setSel(null); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <>
      <PageHead title="Refunds" sub="Requested by staff, approved by a different authorised person, then paid and recorded" />
      <div className="toolbar"><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">{['requested', 'approved', 'processed', 'rejected', ''].map((s) => <option key={s} value={s}>{s ? label(s) : 'All'}</option>)}</select></div>
      <DataTable rows={data?.items} onRowClick={(r) => { setSel(r); setF({ approvedAmount: r.requestedAmount, method: r.method }); }} empty="No refunds in this list." columns={[
        { title: 'Refund', key: 'number' }, { title: 'Order', render: (r) => r.order?.orderNumber }, { title: 'Store', render: (r) => r.store?.code }, { title: 'Reason', key: 'reason' },
        { title: 'Requested', render: (r) => inr(r.requestedAmount), num: true }, { title: 'Approved', render: (r) => (r.approvedAmount != null ? inr(r.approvedAmount) : ''), num: true },
        { title: 'Method', render: (r) => label(r.method) }, { title: 'By', render: (r) => `${r.requestedBy?.name || ''}${r.approvedBy ? ` / ${r.approvedBy.name}` : ''}` }, { title: 'Status', render: (r) => <Status value={r.status} /> },
      ]} />
      {sel && (
        <Modal title={`Refund ${sel.number}`} onClose={() => setSel(null)}>
          <p>Order {sel.order?.orderNumber} · total {inr(sel.order?.grandTotal)} · paid via {label(sel.order?.payment?.method)}</p>
          {sel.status === 'requested' && can('refunds.approve') && (
            <div className="stack">
              <Field label="Approved amount"><input type="number" value={f.approvedAmount} onChange={(e) => setF({ ...f, approvedAmount: e.target.value })} /></Field>
              <Field label="Refund method"><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{['original', 'cash', 'bank_transfer', 'store_credit'].map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></Field>
              <Field label="Notes"><input value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
              <div className="row end">
                <button className="btn ghost" disabled={!f.notes} onClick={() => act('reject', { notes: f.notes }, 'Refund rejected')}>Reject</button>
                <button className="btn" onClick={() => act('approve', { approvedAmount: Number(f.approvedAmount), method: f.method, notes: f.notes || undefined }, 'Refund approved')}>Approve</button>
              </div>
            </div>
          )}
          {sel.status === 'approved' && can('payments.manage') && (
            <div className="stack">
              <p className="muted">Send {inr(sel.approvedAmount)} back ({label(sel.method)}) - from the PhonePe dashboard, your bank, or cash at the counter (POS → cash refund) - then record the reference here.</p>
              <Field label="Refund reference / UTR"><input value={f.paymentReference || ''} onChange={(e) => setF({ ...f, paymentReference: e.target.value })} /></Field>
              <div className="row end"><button className="btn" disabled={!f.paymentReference} onClick={() => act('process', { paymentReference: f.paymentReference }, 'Refund marked as paid')}>Mark refunded</button></div>
            </div>
          )}
          {['processed', 'rejected'].includes(sel.status) && <p className="muted">{label(sel.status)} {sel.paymentReference ? `· Ref ${sel.paymentReference}` : ''} {sel.notes}</p>}
        </Modal>
      )}
    </>
  );
}

export function Expenses() {
  const { can } = useAuth();
  const { storeId, stores } = useAdminStore();
  const single = useSingleStore();
  const toast = useToast();
  const [from, setFrom] = useState(today(-29));
  const [to, setTo] = useState(today());
  const [page, setPage] = useState(1);
  const meta = useApi('/expenses/meta');
  const { data, reload } = useApi(`/expenses${qs({ storeId, from, to, page })}`);
  const [f, setF] = useState({ storeId: single, date: today(), category: 'rent', amount: '', vendor: '', paymentMethod: 'cash', reference: '', notes: '' });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const add = async () => {
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => v !== '' && fd.append(k, v));
      if (file) fd.append('receipt', file);
      await api('/expenses', { method: 'POST', form: fd });
      toast('Expense recorded - awaiting approval');
      setF({ ...f, amount: '', vendor: '', reference: '', notes: '' });
      setFile(null);
      reload();
    } catch (e) { setError(e); }
  };
  const decide = async (id, decision) => { try { await api(`/expenses/${id}/decision`, { method: 'POST', body: { decision } }); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <>
      <PageHead title="Expenses"><button className="btn ghost" onClick={() => download(`/io/export/expenses${qs({ storeId, from, to })}`, 'expenses.xlsx').catch((e) => toast(e.message, 'error'))}>Export</button></PageHead>
      {can('expenses.manage') && (
        <div className="panel stack" style={{ marginBottom: 14 }}>
          <div className="form-grid">
            <Field label="Store"><select value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}>{stores.map((s) => <option key={s._id} value={s._id}>{s.code}</option>)}</select></Field>
            <Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Category"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{(meta.data?.categories || []).map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></Field>
            <Field label="Amount (₹)"><input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="Vendor"><input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></Field>
            <Field label="Paid by"><select value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })}>{['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other'].map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></Field>
            <Field label="Reference"><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
            <Field label="Receipt"><input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files[0])} /></Field>
            <Field label="Notes" full><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          </div>
          <ErrorBox error={error} />
          <div className="row end"><button className="btn" disabled={!f.amount} onClick={add}>Record expense</button></div>
        </div>
      )}
      <div className="toolbar"><Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {data?.byCategory && <span className="muted">{data.byCategory.map((c) => `${label(c._id)} ${inr(c.amount)}`).join(' · ')}</span>}</div>
      <DataTable rows={data?.items} columns={[
        { title: 'Date', render: (e) => date(e.date) }, { title: 'Store', render: (e) => e.store?.code }, { title: 'Category', render: (e) => label(e.category) }, { title: 'Vendor', key: 'vendor' },
        { title: 'Amount', render: (e) => inr(e.amount), num: true }, { title: 'Paid by', render: (e) => label(e.paymentMethod) },
        { title: 'Receipt', render: (e) => e.receipt?.path && <button className="linkbtn" onClick={() => openProtected(fileUrl(e.receipt.path))}>Open</button> },
        { title: 'Status', render: (e) => <Status value={e.status} /> },
        { title: '', render: (e) => e.status === 'pending' && can('expenses.approve') && <span className="row"><button className="btn small" onClick={() => decide(e._id, 'approved')}>Approve</button><button className="btn ghost small" onClick={() => decide(e._id, 'rejected')}>Reject</button></span> },
      ]} />
      <Pager data={data} page={page} setPage={setPage} />
    </>
  );
}

export function Coupons() {
  const toast = useToast();
  const { data, reload } = useApi('/coupons');
  const { stores } = useAdminStore();
  const cats = useApi('/categories?flat=true');
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const save = async () => {
    try {
      const body = { ...edit };
      ['_id', 'createdAt', 'updatedAt', '__v', 'usedCount', 'createdBy'].forEach((k) => delete body[k]);
      for (const k of ['value', 'maxDiscount', 'minOrder', 'usageLimit', 'perUserLimit']) body[k] = body[k] === '' || body[k] == null ? undefined : Number(body[k]);
      body.stores = (body.stores || []).map((s) => s._id || s);
      if (!body.startAt) delete body.startAt;
      if (!body.endAt) delete body.endAt;
      if (edit._id) await api(`/coupons/${edit._id}`, { method: 'PUT', body }); else await api('/coupons', { method: 'POST', body });
      toast('Coupon saved');
      setEdit(null);
      reload();
    } catch (e) { setError(e); }
  };
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const toggle = (k, id) => setEdit({ ...edit, [k]: (edit[k] || []).map((x) => x._id || x).includes(id) ? (edit[k] || []).filter((x) => (x._id || x) !== id) : [...(edit[k] || []), id] });
  return (
    <>
      <PageHead title="Coupons & offers" sub="Coupons never stack with product discounts unless you allow it"><button className="btn" onClick={() => setEdit({ type: 'percent', active: true, showOnOffersPage: true, perUserLimit: 1, stores: [], categories: [], channels: ['online'] })}>New coupon</button></PageHead>
      <DataTable rows={data} onRowClick={(c) => setEdit({ ...c, startAt: c.startAt?.slice(0, 10) || '', endAt: c.endAt?.slice(0, 10) || '' })} columns={[
        { title: 'Code', key: 'code' }, { title: 'Offer', render: (c) => (c.type === 'percent' ? `${c.value}%${c.maxDiscount ? ` up to ${inr(c.maxDiscount)}` : ''}` : inr(c.value)) },
        { title: 'Min order', render: (c) => inr(c.minOrder), num: true }, { title: 'Stores', render: (c) => (c.stores?.length ? c.stores.map((s) => s.code).join(', ') : 'All') },
        { title: 'Valid', render: (c) => `${date(c.startAt) || 'now'} – ${date(c.endAt) || 'open'}` }, { title: 'Used', render: (c) => `${c.usedCount}${c.usageLimit ? `/${c.usageLimit}` : ''}`, num: true },
        { title: 'Status', render: (c) => (c.active ? 'Active' : 'Off') },
      ]} />
      {edit && (
        <Modal title={edit._id ? `Coupon ${edit.code}` : 'New coupon'} onClose={() => setEdit(null)}>
          <div className="form-grid">
            <Field label="Code"><input value={edit.code || ''} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Title"><input value={edit.title || ''} onChange={set('title')} /></Field>
            <Field label="Type"><select value={edit.type} onChange={set('type')}><option value="percent">Percent off</option><option value="flat">Flat ₹ off</option></select></Field>
            <Field label="Value"><input type="number" value={edit.value ?? ''} onChange={set('value')} /></Field>
            <Field label="Max discount (₹)"><input type="number" value={edit.maxDiscount ?? ''} onChange={set('maxDiscount')} /></Field>
            <Field label="Min order (₹)"><input type="number" value={edit.minOrder ?? ''} onChange={set('minOrder')} /></Field>
            <Field label="Starts"><input type="date" value={edit.startAt || ''} onChange={set('startAt')} /></Field>
            <Field label="Ends"><input type="date" value={edit.endAt || ''} onChange={set('endAt')} /></Field>
            <Field label="Total uses allowed"><input type="number" value={edit.usageLimit ?? ''} onChange={set('usageLimit')} /></Field>
            <Field label="Uses per customer"><input type="number" value={edit.perUserLimit ?? ''} onChange={set('perUserLimit')} /></Field>
            <Field label="Description" full><input value={edit.description || ''} onChange={set('description')} /></Field>
          </div>
          <p><b>Channels</b> {['online', 'pos', 'wholesale'].map((c) => <label key={c} className="check" style={{ marginRight: 10 }}><input type="checkbox" checked={(edit.channels || []).includes(c)} onChange={() => toggle('channels', c)} />{label(c)}</label>)}</p>
          <p><b>Stores</b> (none = all) {stores.map((s) => <label key={s._id} className="check" style={{ marginRight: 10 }}><input type="checkbox" checked={(edit.stores || []).map((x) => x._id || x).includes(s._id)} onChange={() => toggle('stores', s._id)} />{s.code}</label>)}</p>
          <p><b>Categories</b> (none = all) {(cats.data || []).filter((c) => !c.parent).map((c) => <label key={c._id} className="check" style={{ marginRight: 10 }}><input type="checkbox" checked={(edit.categories || []).includes(c._id)} onChange={() => toggle('categories', c._id)} />{c.name}</label>)}</p>
          <div className="row">
            <label className="check"><input type="checkbox" checked={Boolean(edit.stackWithProductDiscounts)} onChange={set('stackWithProductDiscounts')} />Also applies to already-discounted items</label>
            <label className="check"><input type="checkbox" checked={Boolean(edit.showOnOffersPage)} onChange={set('showOnOffersPage')} />Show on offers page</label>
            <label className="check"><input type="checkbox" checked={Boolean(edit.active)} onChange={set('active')} />Active</label>
          </div>
          <ErrorBox error={error} />
          <div className="row end"><button className="btn" onClick={save}>Save coupon</button></div>
        </Modal>
      )}
    </>
  );
}
