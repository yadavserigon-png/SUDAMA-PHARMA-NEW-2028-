import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, openProtected } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { inr, dateTime, label } from '../../lib/format';
import { useToast } from '../../state/toast';
import { ErrorBox, Loading, Status, Modal, Field, DataTable } from '../../components/ui';
import { MarkersMap } from '../../components/Maps';

export function MyOrders() {
  const { data, error } = useApi('/orders/my');
  return (
    <div className="section">
      <h1 style={{ fontSize: 'var(--step-2)' }}>My orders</h1>
      <ErrorBox error={error} />
      <DataTable
        rows={data?.items}
        empty="You haven't placed any orders yet."
        columns={[
          { title: 'Order', render: (o) => <Link to={`/orders/${o._id}`}>{o.orderNumber}</Link> },
          { title: 'Date', render: (o) => dateTime(o.createdAt) },
          { title: 'Store', render: (o) => o.store?.name },
          { title: 'Items', render: (o) => o.items.length, num: true },
          { title: 'Total', render: (o) => inr(o.grandTotal), num: true },
          { title: 'Status', render: (o) => <Status value={o.status} /> },
        ]}
      />
    </div>
  );
}

const STEPS = ['placed', 'confirmed', 'packing', 'ready_for_pickup', 'assigned', 'picked_up', 'out_for_delivery', 'delivered'];

export function OrderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data: o, error, reload } = useApi(`/orders/${id}`);
  const [cancel, setCancel] = useState(false);
  const [ret, setRet] = useState(false);
  const [reason, setReason] = useState('');
  const [retItems, setRetItems] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!o || !['assigned', 'picked_up', 'out_for_delivery', 'prescription_review', 'payment_pending', 'confirmed', 'packing'].includes(o.status)) return undefined;
    const t = setInterval(reload, 20000); // refresh tracking every 20 s
    return () => clearInterval(t);
  }, [o, reload]);
  if (error) return <div className="section"><ErrorBox error={error} /></div>;
  if (!o) return <Loading />;
  const reached = new Set(o.timeline.map((t) => t.status));
  const doCancel = async () => {
    setBusy(true);
    try {
      await api(`/orders/${id}/cancel`, { method: 'POST', body: { reason } });
      toast('Order cancelled');
      setCancel(false);
      reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const doReturn = async () => {
    setBusy(true);
    try {
      const items = Object.entries(retItems).filter(([, q]) => q > 0).map(([itemId, qty]) => ({ itemId, qty: Number(qty) }));
      const r = await api(`/orders/${id}/return-request`, { method: 'POST', body: { reason, items } });
      toast(r.message);
      setRet(false);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="section stack">
      <div className="row between">
        <h1 style={{ fontSize: 'var(--step-2)', margin: 0 }}>Order {o.orderNumber}</h1>
        <Status value={o.status} />
      </div>
      {o.status === 'prescription_review' && <div className="notice warn">Our pharmacist is reviewing your prescription. You'll be notified once it is approved.</div>}
      {o.prescriptionStatus === 'clarification' && <div className="notice warn">The pharmacist needs a clearer prescription. Please contact support or upload again from your account.</div>}
      {o.status === 'payment_pending' && <div className="notice warn">Payment is not confirmed yet. If money was deducted, it will be verified automatically or refunded by the bank.</div>}
      {o.deliveryOtp && <div className="panel"><p style={{ margin: 0 }}>Share this OTP with the delivery partner only when you receive your order:</p><span className="otp-box">{o.deliveryOtp}</span></div>}

      <div className="grid grid-2">
        <div className="panel">
          <h3>Tracking</h3>
          <ul className="timeline">
            {o.timeline.map((t, i) => <li key={i}><b>{label(t.status)}</b> <small className="muted">{dateTime(t.at)}</small>{t.note && <div className="muted">{t.note}</div>}</li>)}
          </ul>
          {!['cancelled', 'returned'].includes(o.status) && o.deliveryType === 'delivery' && (
            <small className="muted">Next steps: {STEPS.filter((s) => !reached.has(s)).map(label).join(' → ') || 'Done'}</small>
          )}
        </div>
        <div className="panel">
          <h3>Delivery</h3>
          {o.delivery?.partner && <p>Delivery partner: <b>{o.delivery.partner.name}</b> · <a href={`tel:${o.delivery.partner.phone}`}>Call</a></p>}
          {o.liveLocation ? (
            <>
              <MarkersMap markers={[{ ...o.liveLocation, label: 'Delivery partner', color: '#d9930d' }, ...(o.address?.lat ? [{ lat: o.address.lat, lng: o.address.lng, label: 'Your address' }] : [])]} />
              <small className="muted">Partner location updated {dateTime(o.liveLocation.at)}</small>
            </>
          ) : <p className="muted">{o.deliveryType === 'pickup' ? `Pick up from ${o.store?.name}, ${o.store?.address?.line1}, ${o.store?.address?.city}.` : 'Live location appears here while your order is on the way.'}</p>}
          {o.address?.line1 && <p className="muted">{o.address.name}, {o.address.line1}, {o.address.city} {o.address.pincode}</p>}
        </div>
      </div>

      <div className="panel">
        <h3>Items</h3>
        <DataTable rows={o.items} columns={[
          { title: 'Item', render: (i) => <>{i.name}{i.prescriptionRequired && <span className="rx-tag"> ℞</span>}</> },
          { title: 'Qty', key: 'qty', num: true },
          { title: 'MRP', render: (i) => inr(i.mrp), num: true },
          { title: 'Price', render: (i) => inr(i.unitPrice), num: true },
          { title: 'Amount', render: (i) => inr(i.lineTotal), num: true },
        ]} />
        <div className="stack" style={{ maxWidth: 340, marginLeft: 'auto', marginTop: 12 }}>
          <div className="row between"><span>Discount</span><span>− {inr(o.productDiscount)}</span></div>
          {o.couponDiscount > 0 && <div className="row between"><span>Coupon {o.couponCode}</span><span>− {inr(o.couponDiscount)}</span></div>}
          <div className="row between"><span>Delivery</span><span>{inr(o.deliveryFee)}</span></div>
          <div className="row between"><b>Total</b><b>{inr(o.grandTotal)}</b></div>
          <small className="muted">Payment: {label(o.payment.method)} · {label(o.payment.status)}{o.refundedAmount ? ` · Refunded ${inr(o.refundedAmount)}` : ''}</small>
        </div>
      </div>

      <div className="row">
        {o.completedAt && <button className="btn secondary" onClick={() => openProtected(`/orders/${o._id}/invoice.pdf`).catch((e) => toast(e.message, 'error'))}>Download invoice</button>}
        {['placed', 'prescription_review', 'payment_pending', 'confirmed'].includes(o.status) && <button className="btn ghost" onClick={() => setCancel(true)}>Cancel order</button>}
        {['delivered', 'partially_returned'].includes(o.status) && <button className="btn ghost" onClick={() => setRet(true)}>Return items</button>}
        <Link className="btn ghost" to={`/support?order=${o._id}`}>Get help with this order</Link>
      </div>

      {cancel && (
        <Modal title="Cancel order" onClose={() => setCancel(false)}>
          <Field label="Reason"><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="row end" style={{ marginTop: 12 }}><button className="btn danger" disabled={busy || reason.length < 3} onClick={doCancel}>Cancel order</button></div>
        </Modal>
      )}
      {ret && (
        <Modal title="Return items" onClose={() => setRet(false)}>
          <p className="muted">Only sealed, unused items in original packing can be returned. Our team inspects returned items before the refund.</p>
          {o.items.map((i) => (
            <div key={i._id} className="row between"><span>{i.name} (bought {i.qty - (i.returnedQty || 0)})</span>
              <input type="number" min="0" max={i.qty - (i.returnedQty || 0)} style={{ width: 80 }} value={retItems[i._id] || 0} onChange={(e) => setRetItems({ ...retItems, [i._id]: e.target.value })} aria-label={`Return quantity for ${i.name}`} />
            </div>
          ))}
          <Field label="Reason"><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="row end" style={{ marginTop: 12 }}><button className="btn" disabled={busy || reason.length < 5} onClick={doReturn}>Request return</button></div>
        </Modal>
      )}
    </div>
  );
}

export function PaymentReturn() {
  const [params] = useSearchParams();
  const txn = params.get('txn');
  const orderId = params.get('order');
  const [state, setState] = useState({ status: 'checking' });
  useEffect(() => {
    let tries = 0;
    let t;
    const check = async () => {
      try {
        const r = await api(`/payments/phonepe/status/${txn}`);
        setState(r);
        if (['pending', 'created'].includes(r.status) && tries++ < 10) t = setTimeout(check, 4000);
      } catch (e) { setState({ status: 'error', note: e.message }); }
    };
    if (txn) check();
    return () => clearTimeout(t);
  }, [txn]);
  return (
    <div className="section panel auth-card stack">
      <h2>Payment status</h2>
      {state.status === 'checking' && <Loading text="Confirming payment with PhonePe…" />}
      {state.status === 'success' && <div className="notice">Payment received and verified.</div>}
      {['pending', 'created'].includes(state.status) && <div className="notice warn">Payment is still being processed. This page checks again automatically.</div>}
      {state.status === 'failed' && <div className="notice error">Payment failed{state.note ? `: ${state.note}` : ''}. No order amount has been confirmed.</div>}
      {state.status === 'error' && <div className="notice error">{state.note}</div>}
      {orderId && <Link className="btn" to={`/orders/${orderId}`}>View order</Link>}
    </div>
  );
}
