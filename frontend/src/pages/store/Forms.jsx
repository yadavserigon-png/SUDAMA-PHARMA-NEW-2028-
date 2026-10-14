import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { inr, date } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useSettings } from '../../state/settings';
import { ErrorBox, Field, Loading } from '../../components/ui';
import { MarkersMap, directionsUrl } from '../../components/Maps';

export function UploadPrescription() {
  const { user } = useAuth();
  const [files, setFiles] = useState([]);
  const [f, setF] = useState({ patientName: '', doctorName: '', notes: '' });
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  if (!user) return <div className="auth-card panel">Please <Link to="/login?next=/upload-prescription">log in</Link> to upload a prescription securely.</div>;
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const fd = new FormData();
      [...files].forEach((x) => fd.append('files', x));
      Object.entries(f).forEach(([k, v]) => v && fd.append(k, v));
      setDone(await api('/prescriptions', { method: 'POST', form: fd }));
    } catch (err) { setError(err); }
  };
  if (done) return <div className="auth-card panel stack"><h2>Prescription received</h2><p>Our pharmacist will review it. Add medicines to your cart and attach it at checkout, or <Link to="/request-medicine">ask us to prepare the order</Link>.</p><Link className="btn" to="/search">Find medicines</Link></div>;
  return (
    <form className="auth-card panel stack" onSubmit={submit}>
      <h1 style={{ fontSize: 'var(--step-2)' }}>Upload prescription</h1>
      <p className="muted">Photo or PDF, up to 5 files. Make sure the doctor's name, date, patient name and medicines are readable. Only authorised pharmacists can see it.</p>
      <input type="file" accept="image/*,application/pdf" capture="environment" multiple required onChange={(e) => setFiles(e.target.files)} aria-label="Prescription files" />
      <Field label="Patient name"><input value={f.patientName} onChange={(e) => setF({ ...f, patientName: e.target.value })} /></Field>
      <Field label="Doctor name"><input value={f.doctorName} onChange={(e) => setF({ ...f, doctorName: e.target.value })} /></Field>
      <Field label="Note for pharmacist"><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <ErrorBox error={error} />
      <button className="btn block">Upload</button>
    </form>
  );
}

export function MedicineRequest() {
  const { user } = useAuth();
  const { whatsapp } = useSettings();
  const [params] = useSearchParams();
  const [f, setF] = useState({ name: user?.name || '', phone: user?.phone || '', pincode: '', text: params.get('name') ? `I need: ${params.get('name')}` : '' });
  const [files, setFiles] = useState([]);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => v && fd.append(k, v));
      [...files].forEach((x) => fd.append('files', x));
      setDone(await api('/medicine-requests', { method: 'POST', form: fd }));
    } catch (err) { setError(err); }
  };
  if (done) return <div className="auth-card panel"><h2>Request {done.number} received</h2><p>{done.message}</p></div>;
  return (
    <form className="auth-card panel stack" onSubmit={submit}>
      <h1 style={{ fontSize: 'var(--step-2)' }}>Request a medicine</h1>
      <p className="muted">Tell us what you need or attach a photo of the strip / prescription. A pharmacist will call you to confirm availability and price.</p>
      <Field label="Your name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
      <Field label="Mobile number"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={10} required /></Field>
      <Field label="PIN code"><input value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value })} maxLength={6} /></Field>
      <Field label="Medicines needed"><textarea value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
      <input type="file" accept="image/*,application/pdf" capture="environment" multiple onChange={(e) => setFiles(e.target.files)} aria-label="Photos" />
      <ErrorBox error={error} />
      <button className="btn block">Send request</button>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Prefer WhatsApp? <a href={`${whatsapp.clickToChat}?text=${encodeURIComponent('Hello Sudama Pharma, I need a medicine.')}`} target="_blank" rel="noreferrer">Open a chat with us</a>
        {!whatsapp.apiConfigured && ' (opens WhatsApp; photos sent there are handled manually by our staff)'}.
      </p>
    </form>
  );
}

export function Support() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [f, setF] = useState({ subject: '', message: '', category: params.get('order') ? 'order' : 'general', name: user?.name || '', phone: user?.phone || '' });
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = { subject: f.subject, message: f.message, category: f.category, orderId: params.get('order') || undefined };
      if (!user) Object.assign(body, { name: f.name, phone: f.phone });
      setDone(await api('/support', { method: 'POST', body }));
    } catch (err) { setError(err); }
  };
  if (done) return <div className="auth-card panel"><h2>Ticket {done.number} created</h2><p>Our team will reply soon. Track it under My account.</p></div>;
  return (
    <form className="auth-card panel stack" onSubmit={submit}>
      <h1 style={{ fontSize: 'var(--step-2)' }}>Customer support</h1>
      {!user && (<><Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field><Field label="Mobile"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></Field></>)}
      <Field label="Topic">
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          <option value="general">General question</option><option value="order">Order issue</option><option value="delivery_failure">Delivery problem</option>
          <option value="damaged_product">Damaged product</option><option value="wrong_product">Wrong product</option><option value="refund">Refund</option>
          <option value="payment_dispute">Payment problem</option><option value="prescription">Prescription</option>
        </select>
      </Field>
      <Field label="Subject"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required /></Field>
      <Field label="Details"><textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} required /></Field>
      <ErrorBox error={error} />
      <button className="btn block">Create ticket</button>
    </form>
  );
}

export function Partner() {
  const [params] = useSearchParams();
  const [f, setF] = useState({ type: params.get('type') || 'advertiser', name: '', phone: '', email: '', businessName: '', gstin: '', licenseNo: '', city: '', district: '', message: '' });
  const [files, setFiles] = useState([]);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => v && fd.append(k, v));
      [...files].forEach((x) => fd.append('documents', x));
      setDone(await api('/ads/applications', { method: 'POST', form: fd }));
    } catch (err) { setError(err); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (done) return <div className="auth-card panel"><h2>Application received</h2><p>{done.message}</p></div>;
  return (
    <div className="section grid grid-2" style={{ alignItems: 'start' }}>
      <div className="stack">
        <h1 style={{ fontSize: 'var(--step-3)' }}>Partner with Sudama Pharma</h1>
        <p>Reach customers across our Bihar stores and online, deliver for us, or supply our stores.</p>
        <div className="panel"><h3>Advertise</h3><p className="muted">Homepage banners, category promotions and sponsored product placements. Every paid placement is labelled "Sponsored" and checked for misleading medical claims before going live.</p></div>
        <div className="panel"><h3>Deliver with us</h3><p className="muted">Individual riders and delivery companies can apply. Driving licence, vehicle RC and ID are verified before activation.</p></div>
        <div className="panel"><h3>Supply our stores</h3><p className="muted">Licensed distributors can apply with GST and drug licence details.</p></div>
      </div>
      <form className="panel stack" onSubmit={submit}>
        <Field label="I want to">
          <select value={f.type} onChange={set('type')}>
            <option value="advertiser">Advertise my brand / products</option>
            <option value="delivery_partner">Become a delivery partner</option>
            <option value="delivery_service">Offer delivery services (company)</option>
            <option value="supplier">Supply medicines / products</option>
            <option value="wholesale_buyer">Buy wholesale</option>
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Your name"><input value={f.name} onChange={set('name')} required /></Field>
          <Field label="Mobile"><input value={f.phone} onChange={set('phone')} required maxLength={10} /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Business name"><input value={f.businessName} onChange={set('businessName')} /></Field>
          <Field label="GSTIN"><input value={f.gstin} onChange={set('gstin')} /></Field>
          <Field label="Licence number"><input value={f.licenseNo} onChange={set('licenseNo')} /></Field>
          <Field label="City"><input value={f.city} onChange={set('city')} /></Field>
          <Field label="District"><input value={f.district} onChange={set('district')} /></Field>
        </div>
        <Field label="Message"><textarea value={f.message} onChange={set('message')} /></Field>
        <Field label="Documents" hint="licence, GST, ID - images or PDF"><input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFiles(e.target.files)} /></Field>
        <ErrorBox error={error} />
        <button className="btn">Submit application</button>
      </form>
    </div>
  );
}

export function Offers() {
  const { data } = useApi('/coupons/offers');
  if (!data) return <Loading />;
  return (
    <div className="section">
      <h1 style={{ fontSize: 'var(--step-2)' }}>Offers</h1>
      {!data.length && <p className="muted">No active offers right now.</p>}
      <div className="grid grid-3">
        {data.map((o) => (
          <div key={o._id} className="panel stack">
            <h3>{o.title || (o.type === 'percent' ? `${o.value}% off` : `${inr(o.value)} off`)}</h3>
            {o.description && <p className="muted">{o.description}</p>}
            <div><span className="badge amber" style={{ fontSize: '1rem' }}>{o.code}</span></div>
            <small className="muted">{o.minOrder ? `Min. order ${inr(o.minOrder)}. ` : ''}{o.maxDiscount ? `Max discount ${inr(o.maxDiscount)}. ` : ''}{o.endAt ? `Valid till ${date(o.endAt)}.` : ''} Not combinable with other discounts unless stated.</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StoreLocator() {
  const { data } = useApi('/stores/public');
  const [pin, setPin] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const check = async (e) => {
    e.preventDefault();
    try { setResult(await api(`/stores/serviceability?pincode=${pin}`)); setError(null); } catch (err) { setError(err); }
  };
  const nearMe = () => navigator.geolocation?.getCurrentPosition(async (p) => {
    try { setResult(await api(`/stores/serviceability?lat=${p.coords.latitude}&lng=${p.coords.longitude}`)); } catch (err) { setError(err); }
  }, () => setError(new Error('Location permission denied')));
  return (
    <div className="section stack">
      <h1 style={{ fontSize: 'var(--step-2)' }}>Our stores</h1>
      <form className="row" onSubmit={check}>
        <input style={{ maxWidth: 200, margin: 0 }} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN code" maxLength={6} aria-label="PIN code" />
        <button className="btn">Check delivery</button>
        <button type="button" className="btn ghost" onClick={nearMe}>Use my location</button>
      </form>
      <ErrorBox error={error} />
      {result && (result.serviceable ? <div className="notice">Delivery available from: {result.stores.map((s) => `${s.store.name}${s.distanceKm ? ` (${s.distanceKm} km)` : ''}`).join(', ')}</div> : <div className="notice warn">No store delivers here yet. You can still pick up from a store.</div>)}
      {data && <MarkersMap markers={data.filter((s) => s.location?.lat).map((s) => ({ lat: s.location.lat, lng: s.location.lng, label: s.name }))} circles={data.filter((s) => s.location?.lat).map((s) => ({ ...s.location, radiusKm: s.deliveryRadiusKm }))} />}
      <div className="grid grid-3">
        {(data || []).map((s) => (
          <div className="panel" key={s._id}>
            <h3>{s.name}</h3>
            <p className="muted">{s.address.line1}, {s.address.city}, {s.address.district} {s.address.pincode}</p>
            {s.contact?.phone && <p>Phone <a href={`tel:${s.contact.phone}`}>{s.contact.phone}</a></p>}
            {s.license?.retailDrugLicenseNo && <small className="muted">DL No. {s.license.retailDrugLicenseNo}</small>}
            {s.location?.lat && <p><a href={directionsUrl(s.location.lat, s.location.lng)} target="_blank" rel="noreferrer">Directions</a></p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Policies() {
  const { policies } = useSettings();
  return (
    <div className="section stack" style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 'var(--step-2)' }}>Policies</h1>
      {[['Returns & refunds', policies.returnPolicy], ['Privacy', policies.privacyPolicy], ['Terms of sale', policies.terms], ['Delivery', policies.shippingPolicy]].map(([t, v]) => v && (
        <section key={t} className="panel"><h3>{t}</h3><p style={{ whiteSpace: 'pre-line' }}>{v}</p></section>
      ))}
    </div>
  );
}
