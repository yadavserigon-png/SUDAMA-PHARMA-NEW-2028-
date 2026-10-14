import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, openProtected, fileUrl } from '../../lib/api';
import { useApi, useDebounced, qs } from '../../lib/hooks';
import { inr, dateTime, label, monthYear } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useAdminStore } from '../../state/adminStore';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Field, Modal, PageHead, Pager, Status } from '../../components/ui';

const NEXT = { confirmed: ['packing'], packing: ['ready_for_pickup'], ready_for_pickup: [], delivery_failed: ['ready_for_pickup'] };

export function OrderDetail({ id, onClose, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data: o, reload } = useApi(`/orders/${id}`);
  const partners = useApi(o && can('delivery.manage') && o.deliveryType === 'delivery' ? `/delivery/partners?storeId=${o.store._id}` : null, [o?.store?._id]);
  const [note, setNote] = useState('');
  const [partner, setPartner] = useState('');
  const [returnQty, setReturnQty] = useState({});
  const [fulfil, setFulfil] = useState({});
  const [pay, setPay] = useState({ reference: '', note: '' });
  if (!o) return null;
  const run = async (fn, ok) => {
    try { await fn(); toast(ok); setNote(''); reload(); onChanged?.(); } catch (e) { toast(e.message, 'error'); }
  };
  const status = (s) => run(() => api(`/orders/${id}/status`, { method: 'PATCH', body: { status: s, note: note || undefined } }), `Order moved to ${label(s)}`);
  const review = (decision) => run(() => api(`/orders/${id}/prescription-review`, { method: 'POST', body: { decision, notes: note } }), `Prescription ${decision}d`);
  const cancel = () => run(() => api(`/orders/${id}/cancel`, { method: 'POST', body: { reason: note } }), 'Order cancelled');
  const assign = () => run(() => api('/delivery/assign', { method: 'POST', body: { orderId: id, partnerId: partner } }), 'Delivery partner assigned');
  const doReturn = () => run(() => api(`/orders/${id}/return`, { method: 'POST', body: { reason: note, items: Object.entries(returnQty).filter(([, q]) => Number(q) > 0).map(([itemId, qty]) => ({ itemId, qty: Number(qty) })) } }), 'Return recorded - items moved to quarantine');
  const doPartial = () => run(() => api(`/orders/${id}/partial-fulfil`, { method: 'POST', body: { note, items: Object.entries(fulfil).map(([itemId, q]) => ({ itemId, fulfilQty: Number(q) })) } }), 'Order updated');
  const verifyPay = () => run(() => api('/payments/manual-verify', { method: 'POST', body: { orderId: id, amount: o.grandTotal, reference: pay.reference, note: pay.note } }), 'Payment verified');
  return (
    <Modal title={`Order ${o.orderNumber}`} onClose={onClose} wide>
      <div className="stack">
        <div className="row between">
          <span>{label(o.channel)} · {o.store?.name} · {dateTime(o.createdAt)}</span>
          <span className="row"><Status value={o.status} />{o.prescriptionRequired && <Status value={o.prescriptionStatus} />}<Status value={o.payment.status} /></span>
        </div>
        <div className="grid grid-2">
          <div className="panel tight">
            <b>{o.customerName}</b> {o.customerPhone && <a href={`tel:${o.customerPhone}`}>{o.customerPhone}</a>}
            {o.address?.line1 && <p className="muted" style={{ margin: 0 }}>{o.address.line1}, {o.address.line2} {o.address.city} {o.address.pincode}{o.address.landmark ? ` (near ${o.address.landmark})` : ''}</p>}
            <p className="muted" style={{ margin: 0 }}>{label(o.deliveryType)} · Payment {label(o.payment.method)}{o.payment.reference ? ` · Ref ${o.payment.reference}` : ''}</p>
            {o.notes && <p style={{ margin: 0 }}>Note: {o.notes}</p>}
          </div>
          <div className="panel tight">
            <ul className="timeline">{o.timeline.slice(-5).map((t, i) => <li key={i}><b>{label(t.status)}</b> <small className="muted">{dateTime(t.at)}</small>{t.note && <div className="muted">{t.note}</div>}</li>)}</ul>
          </div>
        </div>
        <DataTable rows={o.items} columns={[
          { title: 'Item', render: (i) => <>{i.name}{i.prescriptionRequired && <span className="rx-tag"> ℞</span>}<br /><small className="muted">{(i.allocations || []).map((a) => `${a.batchNo} (exp ${monthYear(a.expiryDate)}) × ${a.qty}`).join(', ')}</small></> },
          { title: 'Qty', render: (i) => `${i.qty}${i.returnedQty ? ` (−${i.returnedQty} returned)` : ''}`, num: true },
          { title: 'Price', render: (i) => inr(i.unitPrice), num: true }, { title: 'Amount', render: (i) => inr(i.netAmount), num: true },
          { title: 'Cost', render: (i) => inr(i.costTotal), num: true },
          ...(['confirmed', 'packing'].includes(o.status) && o.channel !== 'pos' ? [{ title: 'Ship qty', render: (i) => <input type="number" min="0" max={i.qty} style={{ width: 70 }} placeholder={i.qty} value={fulfil[i._id] ?? ''} onChange={(e) => setFulfil({ ...fulfil, [i._id]: e.target.value })} aria-label="Ship quantity" /> }] : []),
          ...(['delivered', 'completed', 'partially_returned'].includes(o.status) ? [{ title: 'Return qty', render: (i) => <input type="number" min="0" max={i.qty - (i.returnedQty || 0)} style={{ width: 70 }} value={returnQty[i._id] || ''} onChange={(e) => setReturnQty({ ...returnQty, [i._id]: e.target.value })} aria-label="Return quantity" /> }] : []),
        ]} />
        <div className="row end" style={{ gap: 18 }}><span>Discount {inr(o.productDiscount + (o.couponDiscount || 0))}</span><span>Delivery {inr(o.deliveryFee)}</span><span>GST incl. {inr(o.taxTotal)}</span><b>Total {inr(o.grandTotal)}</b>{o.refundedAmount > 0 && <span>Refunded {inr(o.refundedAmount)}</span>}</div>

        {o.prescriptions?.length > 0 && (
          <div className="panel tight">
            <b>Prescriptions</b>{' '}
            {o.prescriptions.map((p) => p.files?.map((f, i) => <button key={f.path} className="btn ghost small" onClick={() => openProtected(fileUrl(f.path)).catch((e) => toast(e.message, 'error'))}>Open file {i + 1}</button>))}
          </div>
        )}

        <Field label="Note / reason (used by the action you choose)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="row">
          {['pending', 'clarification'].includes(o.prescriptionStatus) && can('prescriptions.review') && (
            <>
              <button className="btn" disabled={note.length < 3} onClick={() => review('approve')}>Approve prescription</button>
              <button className="btn warn" disabled={note.length < 3} onClick={() => review('clarify')}>Ask for clarification</button>
              <button className="btn danger" disabled={note.length < 3} onClick={() => review('reject')}>Reject prescription</button>
            </>
          )}
          {can('orders.manage') && (NEXT[o.status] || []).map((s) => <button key={s} className="btn" onClick={() => status(s)}>Mark {label(s)}</button>)}
          {can('orders.manage') && o.status === 'ready_for_pickup' && o.deliveryType === 'pickup' && <button className="btn" onClick={() => status('delivered')}>Handed over to customer</button>}
          {can('orders.manage') && Object.keys(fulfil).length > 0 && <button className="btn secondary" disabled={note.length < 3} onClick={doPartial}>Ship reduced quantities</button>}
          {can('orders.manage', 'pos.use') && Object.keys(returnQty).length > 0 && <button className="btn secondary" disabled={note.length < 3} onClick={doReturn}>Record return</button>}
          {can('orders.manage') && !['delivered', 'completed', 'cancelled', 'returned', 'partially_returned', 'picked_up', 'out_for_delivery'].includes(o.status) && <button className="btn ghost" disabled={note.length < 3} onClick={cancel}>Cancel order</button>}
          {o.completedAt && <button className="btn ghost" onClick={() => openProtected(`/orders/${id}/invoice.pdf`)}>Invoice (A4)</button>}
          {o.completedAt && <button className="btn ghost" onClick={() => openProtected(`/orders/${id}/invoice.pdf?format=thermal`)}>Receipt (80 mm)</button>}
        </div>

        {can('delivery.manage') && o.deliveryType === 'delivery' && ['ready_for_pickup', 'delivery_failed'].includes(o.status) && (
          <div className="panel tight row">
            <b>Assign delivery</b>
            <select style={{ maxWidth: 300 }} value={partner} onChange={(e) => setPartner(e.target.value)} aria-label="Delivery partner">
              <option value="">Choose partner</option>
              {(partners.data || []).filter((p) => p.active && p.deliveryProfile?.approved).map((p) => <option key={p._id} value={p._id}>{p.name} · {p.deliveryProfile.online ? 'online' : 'offline'} · {p.activeAssignments} active</option>)}
            </select>
            <button className="btn" disabled={!partner} onClick={assign}>Assign</button>
          </div>
        )}
        {o.delivery && <p className="muted">Delivery: {o.delivery.partner?.name} · <Status value={o.delivery.status} /></p>}

        {can('payments.manage') && o.payment.status !== 'paid' && !['cancelled'].includes(o.status) && o.payment.method !== 'cod' && (
          <div className="panel tight stack">
            <b>Verify payment from bank / UPI statement</b>
            <small className="muted">Only after you see the credit of {inr(o.grandTotal)} in the merchant bank or UPI statement. Never on a screenshot alone.</small>
            <div className="form-grid">
              <Field label="UTR / bank reference"><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
              <Field label="Checked in"><input placeholder="e.g. SBI current a/c statement" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></Field>
            </div>
            <div className="row end"><button className="btn" disabled={pay.reference.length < 6 || pay.note.length < 5} onClick={verifyPay}>Mark paid</button></div>
          </div>
        )}
        {o.payments?.length > 0 && <small className="muted">Payments: {o.payments.map((p) => `${label(p.provider)} ${inr(p.amount)} ${p.status}${p.verifiedBy ? ` (${label(p.verifiedBy)})` : ''}`).join(' · ')}</small>}
      </div>
    </Modal>
  );
}

export default function Orders() {
  const { storeId } = useAdminStore();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('status') || '');
  const [channel, setChannel] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, reload, error } = useApi(`/orders${qs({ storeId, status, channel, q: dq, page })}`);
  const [open, setOpen] = useState(null);
  return (
    <>
      <PageHead title="Orders" />
      <div className="toolbar">
        <input placeholder="Order no., phone or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All statuses</option>
          <option value="prescription_review">Prescription review</option>
          <option value="payment_pending">Payment pending</option>
          <option value="confirmed,packing,ready_for_pickup">To pack / dispatch</option>
          <option value="assigned,picked_up,out_for_delivery">With delivery partner</option>
          <option value="delivery_failed">Delivery failed</option>
          <option value="delivered,completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="returned,partially_returned">Returned</option>
        </select>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel"><option value="">All channels</option><option value="online">Online</option><option value="pos">Counter</option><option value="wholesale">Wholesale</option></select>
      </div>
      <ErrorBox error={error} />
      <DataTable rows={data?.items} onRowClick={(o) => setOpen(o._id)} empty="No orders match." columns={[
        { title: 'Order', key: 'orderNumber' }, { title: 'When', render: (o) => dateTime(o.createdAt) }, { title: 'Store', render: (o) => o.store?.code }, { title: 'Channel', render: (o) => label(o.channel) },
        { title: 'Customer', render: (o) => `${o.customerName || ''} ${o.customerPhone || ''}` }, { title: 'Total', render: (o) => inr(o.grandTotal), num: true },
        { title: 'Payment', render: (o) => <Status value={o.payment?.status} /> }, { title: 'Status', render: (o) => <Status value={o.status} /> },
      ]} />
      <Pager data={data} page={page} setPage={setPage} />
      {open && <OrderDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}
