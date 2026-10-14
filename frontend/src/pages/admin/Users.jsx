import { useState } from 'react';
import { api, openProtected, fileUrl } from '../../lib/api';
import { useApi, useDebounced, qs } from '../../lib/hooks';
import { date, inr, label } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useAdminStore } from '../../state/adminStore';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Field, Modal, PageHead, Pager, Tabs } from '../../components/ui';

function UserForm({ initial, onClose, onSaved, meta }) {
  const { can, user: me } = useAuth();
  const toast = useToast();
  const { stores } = useAdminStore();
  const isNew = !initial?._id;
  const [f, setF] = useState(() => ({
    name: '', phone: '', email: '', password: '', role: 'pos_operator', stores: [], allStores: false, active: true, permissions: [], deniedPermissions: [],
    ...initial,
    stores: (initial?.stores || []).map((s) => s._id || s),
    employee: { employeeId: '', designation: '', joiningDate: '', status: 'active', shift: { name: '', start: '', end: '' }, ...(initial?.employee || {}), joiningDate: initial?.employee?.joiningDate?.slice(0, 10) || '' },
    deliveryProfile: { vehicleType: '', vehicleNumber: '', licenseNumber: '', ...(initial?.deliveryProfile || {}) },
    wholesale: { businessName: '', gstin: '', drugLicenseNo: '', priceTier: '', creditLimit: 0, ...(initial?.wholesale || {}) },
  }));
  const [salary, setSalary] = useState(initial?.employee?.salary ?? '');
  const [newPw, setNewPw] = useState('');
  const [error, setError] = useState(null);
  const roleInfo = meta?.roles?.find((r) => r.value === f.role);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setNested = (o, k) => (e) => setF({ ...f, [o]: { ...f[o], [k]: e.target.value } });
  const isCustomerish = ['customer', 'wholesale_buyer', 'advertiser'].includes(f.role);
  const save = async () => {
    setError(null);
    try {
      const body = { name: f.name, phone: f.phone, email: f.email || undefined, role: f.role, stores: f.stores, active: f.active };
      if (me.role === 'super_admin') Object.assign(body, { allStores: f.allStores, permissions: f.permissions, deniedPermissions: f.deniedPermissions });
      if (!isCustomerish) body.employee = { ...f.employee, joiningDate: f.employee.joiningDate || undefined, employeeId: f.employee.employeeId || undefined };
      if (f.role === 'delivery_partner') body.deliveryProfile = { vehicleType: f.deliveryProfile.vehicleType, vehicleNumber: f.deliveryProfile.vehicleNumber, licenseNumber: f.deliveryProfile.licenseNumber };
      if (f.role === 'wholesale_buyer') body.wholesale = { businessName: f.wholesale.businessName, gstin: f.wholesale.gstin, drugLicenseNo: f.wholesale.drugLicenseNo, priceTier: f.wholesale.priceTier, creditLimit: Number(f.wholesale.creditLimit || 0) };
      let saved;
      if (isNew) saved = await api('/users', { method: 'POST', body: { ...body, password: f.password } });
      else saved = await api(`/users/${initial._id}`, { method: 'PUT', body });
      if (salary !== '' && can('salary.view') && !isCustomerish) await api(`/users/${saved._id}/salary`, { method: 'PUT', body: { salary: Number(salary) } });
      if (newPw) await api(`/users/${saved._id}/reset-password`, { method: 'POST', body: { password: newPw } });
      toast('User saved');
      onSaved();
    } catch (e) { setError(e); }
  };
  const verifyWholesale = async (verified) => {
    try { await api(`/users/${initial._id}/wholesale`, { method: 'PUT', body: { verified, priceTier: f.wholesale.priceTier || undefined, creditLimit: Number(f.wholesale.creditLimit || 0) } }); toast(verified ? 'Buyer verified' : 'Verification removed'); onSaved(); } catch (e) { setError(e); }
  };
  const togglePerm = (list, p) => setF({ ...f, [list]: f[list].includes(p) ? f[list].filter((x) => x !== p) : [...f[list], p] });
  return (
    <Modal title={isNew ? 'Add user' : f.name} onClose={onClose} wide>
      <div className="stack">
        <div className="form-grid">
          <Field label="Full name"><input value={f.name} onChange={set('name')} /></Field>
          <Field label="Mobile"><input value={f.phone} onChange={set('phone')} maxLength={10} /></Field>
          <Field label="Email"><input value={f.email || ''} onChange={set('email')} /></Field>
          {isNew ? <Field label="Temporary password" hint="share privately; user should change it"><input type="password" value={f.password} onChange={set('password')} /></Field> : <Field label="Set a new password" hint="optional"><input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} /></Field>}
          <Field label="Role"><select value={f.role} onChange={set('role')}>{(meta?.roles || []).filter((r) => r.assignable || r.value === f.role).map((r) => <option key={r.value} value={r.value} disabled={!r.assignable}>{r.label}</option>)}</select></Field>
          <Field label="Status"><select value={f.active ? 'yes' : 'no'} onChange={(e) => setF({ ...f, active: e.target.value === 'yes' })}><option value="yes">Active</option><option value="no">Deactivated</option></select></Field>
        </div>
        {!isCustomerish && (
          <>
            <b>Store access</b>
            <div className="row">
              {stores.map((s) => <label key={s._id} className="check"><input type="checkbox" checked={f.stores.includes(s._id)} onChange={() => setF({ ...f, stores: f.stores.includes(s._id) ? f.stores.filter((x) => x !== s._id) : [...f.stores, s._id] })} />{s.code} · {s.name}</label>)}
              {me.role === 'super_admin' && <label className="check"><input type="checkbox" checked={f.allStores} onChange={set('allStores')} /><b>All stores (consolidated access)</b></label>}
            </div>
            <div className="form-grid">
              <Field label="Employee ID"><input value={f.employee.employeeId || ''} onChange={setNested('employee', 'employeeId')} /></Field>
              <Field label="Designation"><input value={f.employee.designation || ''} onChange={setNested('employee', 'designation')} /></Field>
              <Field label="Joining date"><input type="date" value={f.employee.joiningDate || ''} onChange={setNested('employee', 'joiningDate')} /></Field>
              <Field label="Employment status"><select value={f.employee.status} onChange={setNested('employee', 'status')}>{['active', 'on_leave', 'resigned', 'terminated'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
              <Field label="Shift"><input placeholder="e.g. Morning 08:00-16:00" value={f.employee.shift?.name || ''} onChange={(e) => setF({ ...f, employee: { ...f.employee, shift: { ...(f.employee.shift || {}), name: e.target.value } } })} /></Field>
              {can('salary.view') && <Field label="Monthly salary (₹)" hint="visible to authorised users only"><input type="number" value={salary} onChange={(e) => setSalary(e.target.value)} /></Field>}
            </div>
          </>
        )}
        {f.role === 'delivery_partner' && (
          <div className="form-grid">
            <Field label="Vehicle type"><input value={f.deliveryProfile.vehicleType || ''} onChange={setNested('deliveryProfile', 'vehicleType')} /></Field>
            <Field label="Vehicle number"><input value={f.deliveryProfile.vehicleNumber || ''} onChange={setNested('deliveryProfile', 'vehicleNumber')} /></Field>
            <Field label="Driving licence no."><input value={f.deliveryProfile.licenseNumber || ''} onChange={setNested('deliveryProfile', 'licenseNumber')} /></Field>
          </div>
        )}
        {f.role === 'wholesale_buyer' && (
          <div className="stack">
            <div className="form-grid">
              <Field label="Business name"><input value={f.wholesale.businessName || ''} onChange={setNested('wholesale', 'businessName')} /></Field>
              <Field label="GSTIN"><input value={f.wholesale.gstin || ''} onChange={setNested('wholesale', 'gstin')} /></Field>
              <Field label="Drug licence no."><input value={f.wholesale.drugLicenseNo || ''} onChange={setNested('wholesale', 'drugLicenseNo')} /></Field>
              <Field label="Licence valid till"><input value={date(f.wholesale.drugLicenseValidTill)} disabled /></Field>
              <Field label="Price tier"><input value={f.wholesale.priceTier || ''} onChange={setNested('wholesale', 'priceTier')} /></Field>
              <Field label="Credit limit (₹)"><input type="number" value={f.wholesale.creditLimit || 0} onChange={setNested('wholesale', 'creditLimit')} /></Field>
            </div>
            {f.wholesale.documents?.map((d, i) => <button key={d._id} className="btn ghost small" onClick={() => openProtected(fileUrl(d.path))}>Document {i + 1}</button>)}
            {!isNew && can('wholesale.manage') && (f.wholesale.verified
              ? <button className="btn ghost" onClick={() => verifyWholesale(false)}>Remove verification</button>
              : <button className="btn" onClick={() => verifyWholesale(true)}>Verify buyer (licence and GST checked)</button>)}
          </div>
        )}
        {roleInfo && <small className="muted">This role can: {roleInfo.permissions.includes('*') ? 'everything' : roleInfo.permissions.map(label).join(', ') || 'shop as a customer'}</small>}
        {me.role === 'super_admin' && !isCustomerish && f.role !== 'super_admin' && (
          <details>
            <summary>Individual permission overrides</summary>
            <div className="grid grid-2" style={{ marginTop: 8 }}>
              <div><b>Extra permissions</b>{meta.permissions.filter((p) => !roleInfo?.permissions.includes(p)).map((p) => <div key={p}><label className="check"><input type="checkbox" checked={f.permissions.includes(p)} onChange={() => togglePerm('permissions', p)} />{p}</label></div>)}</div>
              <div><b>Remove from this user</b>{(roleInfo?.permissions || []).filter((p) => p !== '*').map((p) => <div key={p}><label className="check"><input type="checkbox" checked={f.deniedPermissions.includes(p)} onChange={() => togglePerm('deniedPermissions', p)} />{p}</label></div>)}</div>
            </div>
          </details>
        )}
        <ErrorBox error={error} />
        <div className="row end"><button className="btn" onClick={save}>Save user</button></div>
      </div>
    </Modal>
  );
}

export default function Users() {
  const { storeId } = useAdminStore();
  const [tab, setTab] = useState('staff');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const meta = useApi('/users/meta/roles');
  const roleParam = { staff: 'staff', delivery: 'delivery_partner', customers: 'customer', wholesale: 'wholesale_buyer', advertisers: 'advertiser' }[tab];
  const { data, reload, error } = useApi(`/users${qs({ role: roleParam, q: dq, page, storeId: ['staff', 'delivery'].includes(tab) ? storeId : undefined })}`);
  const [edit, setEdit] = useState(null);
  const open = async (u) => setEdit(await api(`/users/${u._id}`));
  return (
    <>
      <PageHead title="Users & roles"><button className="btn" onClick={() => setEdit({ role: tab === 'delivery' ? 'delivery_partner' : tab === 'wholesale' ? 'wholesale_buyer' : tab === 'customers' ? 'customer' : 'pos_operator' })}>Add user</button></PageHead>
      <Tabs value={tab} onChange={(t) => { setTab(t); setPage(1); }} tabs={[{ value: 'staff', label: 'Staff & admins' }, { value: 'delivery', label: 'Delivery partners' }, { value: 'customers', label: 'Customers' }, { value: 'wholesale', label: 'Wholesale buyers' }, { value: 'advertisers', label: 'Advertisers' }]} />
      <div className="toolbar"><input placeholder="Search name, phone, email, employee ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" /></div>
      <ErrorBox error={error} />
      <DataTable rows={data?.items} onRowClick={open} columns={[
        { title: 'Name', render: (u) => <>{u.name}{u.employee?.employeeId ? <small className="muted"> #{u.employee.employeeId}</small> : null}</> },
        { title: 'Phone', key: 'phone' }, { title: 'Role', key: 'roleLabel' },
        { title: tab === 'wholesale' ? 'Business' : 'Stores', render: (u) => (tab === 'wholesale' ? u.wholesale?.businessName : u.allStores ? 'All stores' : u.stores?.map((s) => s.code).join(', ')) },
        ...(tab === 'wholesale' ? [{ title: 'Verified', render: (u) => (u.wholesale?.verified ? <span className="badge green">Verified</span> : <span className="badge amber">Pending</span>) }] : []),
        ...(tab === 'staff' && data?.items?.some((u) => u.employee?.salary != null) ? [{ title: 'Salary', render: (u) => (u.employee?.salary != null ? inr(u.employee.salary) : ''), num: true }] : []),
        { title: 'Status', render: (u) => (u.active ? 'Active' : <span className="badge red">Deactivated</span>) },
      ]} />
      <Pager data={data} page={page} setPage={setPage} />
      {edit && <UserForm initial={edit} meta={meta.data} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}
