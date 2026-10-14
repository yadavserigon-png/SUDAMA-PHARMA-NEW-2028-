import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, newKey } from '../../lib/api';
import { useApi, qs, useDebounced } from '../../lib/hooks';
import { inr, date } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Field, Status } from '../../components/ui';

function Register() {
  const { acceptLogin } = useAuth();
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '', businessName: '', gstin: '', drugLicenseNo: '', drugLicenseValidTill: '' });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => v && fd.append(k, v));
      [...files].forEach((x) => fd.append('documents', x));
      const r = await api('/wholesale/register', { method: 'POST', form: fd });
      acceptLogin({ ...r, permissions: ['wholesale.self'] });
      window.location.reload();
    } catch (err) { setError(err); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>Register as a wholesale buyer</h2>
      <p className="muted">For licensed chemists, clinics and hospitals. Wholesale ordering opens after we verify your drug licence and GST registration.</p>
      <div className="form-grid">
        <Field label="Contact name"><input value={f.name} onChange={set('name')} required /></Field>
        <Field label="Mobile"><input value={f.phone} onChange={set('phone')} required maxLength={10} /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Password"><input type="password" value={f.password} onChange={set('password')} required /></Field>
        <Field label="Business name"><input value={f.businessName} onChange={set('businessName')} required /></Field>
        <Field label="GSTIN"><input value={f.gstin} onChange={set('gstin')} required maxLength={15} /></Field>
        <Field label="Drug licence number"><input value={f.drugLicenseNo} onChange={set('drugLicenseNo')} required /></Field>
        <Field label="Licence valid till"><input type="date" value={f.drugLicenseValidTill} onChange={set('drugLicenseValidTill')} required /></Field>
      </div>
      <Field label="Licence and GST documents"><input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFiles(e.target.files)} required /></Field>
      <ErrorBox error={error} />
      <button className="btn">Register</button>
    </form>
  );
}

function Portal() {
  const { user } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const verified = user.wholesale?.verified;
  const catalog = useApi(verified ? `/wholesale/catalog${qs({ q: dq })}` : null);
  const quotes = useApi('/wholesale/quotations');
  const stores = useApi('/stores/public');
  const [cart, setCart] = useState({});
  const [storeId, setStoreId] = useState('');
  const [po, setPo] = useState('');
  const items = Object.entries(cart).filter(([, v]) => v.qty > 0);
  const send = async (mode) => {
    try {
      const body = { storeId, items: items.map(([productId, v]) => ({ productId, qty: Number(v.qty) })), buyerPoNumber: po || undefined };
      if (mode === 'quote') await api('/wholesale/quotations', { method: 'POST', body });
      else await api('/wholesale/orders', { method: 'POST', body: { ...body, paymentMethod: mode, idempotencyKey: newKey() } });
      toast(mode === 'quote' ? 'Quotation requested' : 'Order placed');
      setCart({});
      quotes.reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  const accept = async (id, paymentMethod) => {
    try { await api(`/wholesale/quotations/${id}/accept`, { method: 'POST', body: { paymentMethod } }); toast('Order placed from quotation'); quotes.reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="stack">
      <div className="panel row between">
        <span><b>{user.wholesale?.businessName}</b> · GSTIN {user.wholesale?.gstin} · DL {user.wholesale?.drugLicenseNo}</span>
        {verified ? <span className="badge green">Verified buyer{user.wholesale?.priceTier ? ` · ${user.wholesale.priceTier}` : ''}</span> : <span className="badge amber">Verification pending</span>}
      </div>
      {!verified && <div className="notice warn">Our team is verifying your licence and GST details. Wholesale prices and ordering open after verification.</div>}
      {verified && (
        <div className="panel stack">
          <div className="row between"><h3 style={{ margin: 0 }}>Catalogue</h3><input style={{ maxWidth: 280 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search catalogue" /></div>
          <DataTable rows={catalog.data} columns={[
            { title: 'Product', render: (p) => <>{p.name}<br /><small className="muted">{p.manufacturer} · {p.packSize}</small></> },
            { title: 'MRP', render: (p) => inr(p.mrp), num: true },
            { title: 'Your price', render: (p) => <b>{inr(p.wholesalePrice)}</b>, num: true },
            { title: 'Min qty', key: 'minWholesaleQty', num: true },
            { title: 'Qty', render: (p) => <input type="number" min="0" style={{ width: 90 }} value={cart[p._id]?.qty || ''} onChange={(e) => setCart({ ...cart, [p._id]: { qty: e.target.value, name: p.name } })} aria-label={`Quantity of ${p.name}`} /> },
          ]} />
          {items.length > 0 && (
            <div className="row">
              <select style={{ maxWidth: 260 }} value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Supplying store">
                <option value="">Supplying store</option>
                {(stores.data || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
              <input style={{ maxWidth: 200 }} placeholder="Your PO number" value={po} onChange={(e) => setPo(e.target.value)} aria-label="PO number" />
              <button className="btn secondary" disabled={!storeId} onClick={() => send('quote')}>Request quotation</button>
              <button className="btn" disabled={!storeId} onClick={() => send('bank')}>Order (pay by bank)</button>
              <button className="btn ghost" disabled={!storeId} onClick={() => send('credit')}>Order on credit</button>
            </div>
          )}
        </div>
      )}
      <div className="panel">
        <h3>Quotations</h3>
        <DataTable rows={quotes.data} empty="No quotations yet." columns={[
          { title: 'Number', key: 'number' }, { title: 'Store', render: (q2) => q2.store?.name }, { title: 'Items', render: (q2) => q2.items.length, num: true },
          { title: 'Total', render: (q2) => (q2.total ? inr(q2.total) : '-'), num: true }, { title: 'Valid till', render: (q2) => date(q2.validTill) }, { title: 'Status', render: (q2) => <Status value={q2.status} /> },
          { title: '', render: (q2) => q2.status === 'quoted' && <span className="row"><button className="btn small" onClick={() => accept(q2._id, 'bank')}>Accept</button><button className="btn ghost small" onClick={() => accept(q2._id, 'credit')}>Accept on credit</button></span> },
        ]} />
      </div>
      <p><Link to="/orders">Order history and invoices</Link></p>
    </div>
  );
}

export default function Wholesale() {
  const { user } = useAuth();
  return (
    <div className="section stack">
      <h1 style={{ fontSize: 'var(--step-2)' }}>Wholesale portal</h1>
      {!user && <><Register /><p>Already registered? <Link to="/login?next=/wholesale">Log in</Link></p></>}
      {user?.role === 'wholesale_buyer' && <Portal />}
      {user && user.role !== 'wholesale_buyer' && <div className="panel">This page is for wholesale buyer accounts. <Link to="/partner?type=wholesale_buyer">Apply for wholesale</Link></div>}
    </div>
  );
}
