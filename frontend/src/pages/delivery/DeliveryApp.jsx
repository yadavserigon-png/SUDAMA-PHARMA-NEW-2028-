// Delivery partner app (mobile first). Location is sent only while an order is picked up / out for delivery.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { inr, dateTime, label } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useToast } from '../../state/toast';
import { Field, Modal, Status, Tabs } from '../../components/ui';
import { directionsUrl } from '../../components/Maps';

/** Shares real device GPS for one active assignment; stops when the server says so or on unmount. */
function useLiveLocation(assignmentId, active) {
  const [state, setState] = useState('off');
  useEffect(() => {
    if (!active || !assignmentId || !navigator.geolocation) { setState(navigator.geolocation ? 'off' : 'unsupported'); return undefined; }
    let last = 0;
    const watch = navigator.geolocation.watchPosition(async (pos) => {
      if (Date.now() - last < 15000) return; // at most every 15 s
      last = Date.now();
      try {
        const r = await api('/delivery/location', { method: 'POST', body: { assignmentId, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } });
        setState(r.accepted ? 'sharing' : 'stopped');
        if (r.stopTracking) navigator.geolocation.clearWatch(watch);
      } catch { setState('error'); }
    }, (err) => setState(err.code === 1 ? 'denied' : 'error'), { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, [assignmentId, active]);
  return state;
}

function Job({ a, onChange }) {
  const toast = useToast();
  const [otp, setOtp] = useState('');
  const [fail, setFail] = useState(null);
  const tracking = ['picked_up', 'out_for_delivery'].includes(a.status);
  const loc = useLiveLocation(a._id, tracking);
  const o = a.order || {};
  const run = async (path, body, msg) => {
    try { await api(`/delivery/assignments/${a._id}/${path}`, { method: 'POST', body: body || {} }); toast(msg); onChange(); } catch (e) { toast(e.message, 'error'); }
  };
  const dest = o.address?.lat ? directionsUrl(o.address.lat, o.address.lng) : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([o.address?.line1, o.address?.city, o.address?.pincode].filter(Boolean).join(', '))}`;
  const storeNav = a.store?.location?.lat ? directionsUrl(a.store.location.lat, a.store.location.lng) : null;
  const cod = o.payment?.method === 'cod' && o.payment?.status !== 'paid';
  return (
    <div className="dcard stack">
      <div className="row between"><b>{o.orderNumber}</b><Status value={a.status} /></div>
      <div>Pick up: {a.store?.name}, {a.store?.address?.line1}, {a.store?.address?.city} {storeNav && <a href={storeNav} target="_blank" rel="noreferrer">Navigate</a>}</div>
      <div>Deliver to: <b>{o.customerName}</b>, {o.address?.line1}, {o.address?.line2} {o.address?.city} {o.address?.pincode}{o.address?.landmark ? ` (near ${o.address.landmark})` : ''}</div>
      <div className="row"><a className="btn secondary small" href={`tel:${o.customerPhone}`}>Call customer</a><a className="btn secondary small" href={dest} target="_blank" rel="noreferrer">Navigate to customer</a></div>
      <div className="muted">{o.items?.map((i) => `${i.name} × ${i.qty}`).join(', ')}</div>
      {cod ? <div className="notice warn">Collect cash {inr(o.grandTotal)}</div> : <div className="notice">Prepaid - do not collect money</div>}
      {tracking && <small className="muted">Location sharing: {label(loc)}{loc === 'denied' ? ' - allow location in phone settings' : ''}</small>}
      {a.status === 'assigned' && <button className="btn" onClick={() => run('accept', null, 'Accepted')}>Accept</button>}
      {['assigned', 'accepted'].includes(a.status) && <button className="btn" onClick={() => run('pickup', null, 'Picked up')}>Picked up from store</button>}
      {a.status === 'picked_up' && <button className="btn" onClick={() => run('out', null, 'Out for delivery')}>Start delivery</button>}
      {['picked_up', 'out_for_delivery'].includes(a.status) && (
        <>
          <Field label="Customer's 4-digit OTP"><input inputMode="numeric" maxLength={4} value={otp} onChange={(e) => setOtp(e.target.value)} /></Field>
          <button className="btn" disabled={otp.length !== 4} onClick={() => run('deliver', { otp, codCollected: cod ? o.grandTotal : undefined }, 'Delivered')}>{cod ? `Cash collected ${inr(o.grandTotal)} - mark delivered` : 'Mark delivered'}</button>
          <button className="btn ghost" onClick={() => setFail({ reason: 'customer_unavailable', note: '' })}>Could not deliver</button>
        </>
      )}
      {a.status === 'failed' && <button className="btn secondary" onClick={() => run('return-to-store', null, 'Returned to store')}>Returned the parcel to store</button>}
      {fail && (
        <Modal title="Delivery failed" onClose={() => setFail(null)}>
          <Field label="Reason"><select value={fail.reason} onChange={(e) => setFail({ ...fail, reason: e.target.value })}>{['customer_unavailable', 'wrong_address', 'customer_refused', 'payment_issue', 'vehicle_issue', 'other'].map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></Field>
          <Field label="Details"><input value={fail.note} onChange={(e) => setFail({ ...fail, note: e.target.value })} /></Field>
          <div className="row end" style={{ marginTop: 10 }}><button className="btn danger" onClick={() => { run('fail', { reason: fail.reason, note: fail.note || undefined }, 'Reported'); setFail(null); }}>Report</button></div>
        </Modal>
      )}
    </div>
  );
}

export default function DeliveryApp() {
  const { user, logout, refresh } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('active');
  const me = useApi('/delivery/me');
  const jobs = useApi(`/delivery/me/assignments${tab === 'history' ? '?history=true' : ''}`, [tab]);
  const poll = useRef(null);
  useEffect(() => {
    poll.current = setInterval(() => { if (tab === 'active') jobs.reload(); }, 30000);
    return () => clearInterval(poll.current);
  }, [tab, jobs.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const online = me.data?.profile?.deliveryProfile?.online;
  const toggle = async () => {
    try { await api('/delivery/me/online', { method: 'POST', body: { online: !online } }); me.reload(); refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  const uploadDoc = async (file, docType) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('docType', docType);
    try { await api('/delivery/me/documents', { method: 'POST', form: fd }); toast('Document uploaded for verification'); me.reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const p = me.data?.profile?.deliveryProfile;
  return (
    <div className="dapp">
      <div className="row between" style={{ marginBottom: 10 }}><b>Sudama Pharma · Deliveries</b><button className="btn ghost small" onClick={logout}>Log out</button></div>
      <p className="muted" style={{ margin: '0 0 8px' }}>{user?.name}</p>
      {p && !p.approved && <div className="notice warn" style={{ marginBottom: 10 }}>Your profile is waiting for approval. Upload your documents below.</div>}
      <div className="switch"><span>{online ? 'You are online' : 'You are offline'}</span><button className={`btn ${online ? 'ghost' : ''}`} onClick={toggle}>{online ? 'Go offline' : 'Go online'}</button></div>
      {me.data && <div className="kpis" style={{ marginBottom: 12 }}><div className="kpi"><div className="v">{me.data.todayDelivered}</div><div className="l">Delivered today</div></div><div className="kpi"><div className="v">{inr(me.data.lifetime.earnings)}</div><div className="l">Total earnings</div></div><div className="kpi"><div className="v">{inr(me.data.lifetime.codPending)}</div><div className="l">Cash to deposit</div></div></div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'active', label: 'Active' }, { value: 'history', label: 'History' }, { value: 'docs', label: 'Documents' }]} />
      {tab === 'active' && (jobs.data?.length ? jobs.data.map((a) => <Job key={a._id} a={a} onChange={jobs.reload} />) : <p className="muted">No active deliveries. Stay online to receive orders.</p>)}
      {tab === 'history' && (jobs.data || []).map((a) => <div key={a._id} className="dcard row between"><span>{a.order?.orderNumber}<br /><small className="muted">{dateTime(a.deliveredAt || a.updatedAt)}</small></span><span><Status value={a.status} /> {inr(a.earnings + a.incentive)}</span></div>)}
      {tab === 'docs' && (
        <div className="stack">
          {(p?.documents || []).map((d) => <div key={d._id} className="dcard row between"><span>{label(d.docType)}</span>{d.verified ? <span className="badge green">Verified</span> : <span className="badge amber">Pending</span>}</div>)}
          {['driving_licence', 'vehicle_rc', 'id_proof', 'photo'].map((t) => <Field key={t} label={`Upload ${label(t)}`}><input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => e.target.files[0] && uploadDoc(e.target.files[0], t)} /></Field>)}
        </div>
      )}
    </div>
  );
}
