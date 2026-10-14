import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, openProtected, fileUrl } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { dateTime, inr } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useToast } from '../../state/toast';
import { DataTable, Field, Status, Tabs, ErrorBox } from '../../components/ui';

function Profile() {
  const { user, refresh, acceptLogin, session } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ name: user.name, email: user.email || '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState(null);
  const save = async () => {
    try { await api('/auth/me', { method: 'PUT', body: { name: f.name, email: f.email || undefined } }); await refresh(); toast('Profile saved'); } catch (e) { setError(e); }
  };
  const changePw = async () => {
    try {
      const r = await api('/auth/change-password', { method: 'POST', body: pw });
      acceptLogin({ ...session, token: r.token });
      setPw({ currentPassword: '', newPassword: '' });
      toast('Password changed. Other devices have been logged out.');
    } catch (e) { setError(e); }
  };
  return (
    <div className="grid grid-2">
      <div className="panel stack">
        <h3>Profile</h3>
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <p className="muted">Mobile: {user.phone} {user.phoneVerified ? <span className="badge green">Verified</span> : <span className="badge amber">Not verified</span>}</p>
        <button className="btn" onClick={save}>Save profile</button>
      </div>
      <div className="panel stack">
        <h3>Password</h3>
        <Field label="Current password"><input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
        <Field label="New password"><input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
        <button className="btn secondary" onClick={changePw}>Change password</button>
        <button className="linkbtn" onClick={() => api('/auth/logout-all', { method: 'POST' }).then(() => toast('Logged out on all devices')).then(() => window.location.assign('/login'))}>Log out on all devices</button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

function Addresses() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const blank = { label: 'Home', name: user.name, phone: user.phone, line1: '', line2: '', city: '', district: '', pincode: '' };
  const [f, setF] = useState(blank);
  const [error, setError] = useState(null);
  const add = async () => {
    try { await api('/auth/me/addresses', { method: 'POST', body: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) }); await refresh(); setF(blank); toast('Address saved'); } catch (e) { setError(e); }
  };
  const del = async (id) => { await api(`/auth/me/addresses/${id}`, { method: 'DELETE' }); refresh(); };
  const def = async (id) => { await api(`/auth/me/addresses/${id}`, { method: 'PUT', body: { isDefault: true } }); refresh(); };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="stack">
      {user.addresses?.map((a) => (
        <div className="panel tight row between" key={a._id}>
          <span><b>{a.label}</b> {a.isDefault && <span className="badge green">Default</span>}<br />{a.name}, {a.line1}, {a.line2} {a.city} {a.district} {a.pincode}</span>
          <span className="row">{!a.isDefault && <button className="btn ghost small" onClick={() => def(a._id)}>Make default</button>}<button className="btn ghost small" onClick={() => del(a._id)}>Remove</button></span>
        </div>
      ))}
      <div className="panel">
        <h3>Add address</h3>
        <div className="form-grid">
          <Field label="Label"><input value={f.label} onChange={set('label')} /></Field>
          <Field label="Name"><input value={f.name} onChange={set('name')} /></Field>
          <Field label="Mobile"><input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="House / street" full><input value={f.line1} onChange={set('line1')} /></Field>
          <Field label="Area"><input value={f.line2} onChange={set('line2')} /></Field>
          <Field label="City"><input value={f.city} onChange={set('city')} /></Field>
          <Field label="District"><input value={f.district} onChange={set('district')} /></Field>
          <Field label="PIN code"><input value={f.pincode} onChange={set('pincode')} maxLength={6} /></Field>
        </div>
        <ErrorBox error={error} />
        <button className="btn" style={{ marginTop: 10 }} onClick={add}>Save address</button>
      </div>
    </div>
  );
}

function Prescriptions() {
  const { data } = useApi('/prescriptions/mine');
  return (
    <div className="stack">
      <Link className="btn" to="/upload-prescription">Upload a prescription</Link>
      <DataTable rows={data} empty="No prescriptions uploaded yet." columns={[
        { title: 'Uploaded', render: (p) => dateTime(p.createdAt) },
        { title: 'Files', render: (p) => p.files.map((f, i) => <button key={f.path} className="linkbtn" onClick={() => openProtected(fileUrl(f.path))}>File {i + 1} </button>) },
        { title: 'Status', render: (p) => <Status value={p.status} /> },
        { title: 'Pharmacist note', key: 'reviewNotes' },
      ]} />
    </div>
  );
}

function Requests() {
  const req = useApi('/medicine-requests/mine');
  const ref = useApi('/refunds/mine');
  const tk = useApi('/support/mine');
  return (
    <div className="stack">
      <h3>Medicine requests</h3>
      <DataTable rows={req.data} empty="No requests." columns={[{ title: 'Request', key: 'number' }, { title: 'Details', key: 'text' }, { title: 'Status', render: (r) => <Status value={r.status} /> }, { title: 'Date', render: (r) => dateTime(r.createdAt) }]} />
      <h3>Refunds</h3>
      <DataTable rows={ref.data} empty="No refunds." columns={[{ title: 'Refund', key: 'number' }, { title: 'Order', render: (r) => r.order?.orderNumber }, { title: 'Amount', render: (r) => inr(r.approvedAmount ?? r.requestedAmount), num: true }, { title: 'Status', render: (r) => <Status value={r.status} /> }, { title: 'Reference', key: 'paymentReference' }]} />
      <h3>Support tickets</h3>
      <DataTable rows={tk.data} empty="No tickets." columns={[{ title: 'Ticket', key: 'number' }, { title: 'Subject', key: 'subject' }, { title: 'Status', render: (t) => <Status value={t.status} /> }, { title: 'Last reply', render: (t) => t.messages.at(-1)?.text?.slice(0, 80) }]} />
    </div>
  );
}

export default function Account() {
  const [tab, setTab] = useState('profile');
  return (
    <div className="section">
      <h1 style={{ fontSize: 'var(--step-2)' }}>My account</h1>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'profile', label: 'Profile' }, { value: 'addresses', label: 'Addresses' }, { value: 'rx', label: 'Prescriptions' }, { value: 'requests', label: 'Requests, refunds & help' }]} />
      {tab === 'profile' && <Profile />}
      {tab === 'addresses' && <Addresses />}
      {tab === 'rx' && <Prescriptions />}
      {tab === 'requests' && <Requests />}
      <p style={{ marginTop: 16 }}><Link to="/orders">View my orders</Link></p>
    </div>
  );
}
