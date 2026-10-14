import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi, useDebounced, qs } from '../../lib/hooks';
import { inr } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useAdminStore } from '../../state/adminStore';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Field, Modal, PageHead } from '../../components/ui';

export default function Suppliers() {
  const { can } = useAuth();
  const toast = useToast();
  const { storeId } = useAdminStore();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, reload } = useApi(`/suppliers${qs({ q: dq, storeId, active: 'all' })}`);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setAddr = (k) => (e) => setEdit({ ...edit, address: { ...(edit.address || {}), [k]: e.target.value } });
  const save = async () => {
    try {
      const allowed = ['name', 'code', 'contactPerson', 'phone', 'email', 'address', 'gstin', 'drugLicenseNo', 'drugLicenseValidTill', 'paymentTermsDays', 'notes', 'active'];
      const body = Object.fromEntries(Object.entries(edit).filter(([k, v]) => allowed.includes(k) && v !== '' && v !== undefined));
      if (body.paymentTermsDays) body.paymentTermsDays = Number(body.paymentTermsDays);
      if (body.drugLicenseValidTill) body.drugLicenseValidTill = body.drugLicenseValidTill.slice(0, 10);
      if (edit._id) await api(`/suppliers/${edit._id}`, { method: 'PUT', body }); else await api('/suppliers', { method: 'POST', body });
      toast('Supplier saved');
      setEdit(null);
      reload();
    } catch (e) { setError(e); }
  };
  return (
    <>
      <PageHead title="Suppliers & distributors">{can('suppliers.manage') && <button className="btn" onClick={() => setEdit({ active: true, paymentTermsDays: 30 })}>Add supplier</button>}</PageHead>
      <div className="toolbar"><input placeholder="Search name, GSTIN, phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></div>
      <DataTable rows={data} onRowClick={can('suppliers.manage') ? setEdit : undefined} columns={[
        { title: 'Name', key: 'name' }, { title: 'Contact', render: (s) => `${s.contactPerson || ''} ${s.phone || ''}` }, { title: 'GSTIN', key: 'gstin' }, { title: 'Drug licence', key: 'drugLicenseNo' },
        { title: 'Purchases', key: 'purchases', num: true }, { title: 'Invoiced', render: (s) => inr(s.invoiced), num: true }, { title: 'Paid', render: (s) => inr(s.paid), num: true },
        { title: 'Outstanding', render: (s) => <b>{inr(s.outstanding)}</b>, num: true }, { title: '', render: (s) => (s.active ? '' : <span className="badge red">Inactive</span>) },
      ]} />
      {edit && (
        <Modal title={edit._id ? edit.name : 'Add supplier'} onClose={() => setEdit(null)}>
          <div className="form-grid">
            <Field label="Name"><input value={edit.name || ''} onChange={set('name')} /></Field>
            <Field label="Code"><input value={edit.code || ''} onChange={set('code')} /></Field>
            <Field label="Contact person"><input value={edit.contactPerson || ''} onChange={set('contactPerson')} /></Field>
            <Field label="Phone"><input value={edit.phone || ''} onChange={set('phone')} /></Field>
            <Field label="Email"><input value={edit.email || ''} onChange={set('email')} /></Field>
            <Field label="GSTIN"><input value={edit.gstin || ''} onChange={set('gstin')} /></Field>
            <Field label="Drug licence no."><input value={edit.drugLicenseNo || ''} onChange={set('drugLicenseNo')} /></Field>
            <Field label="Licence valid till"><input type="date" value={edit.drugLicenseValidTill?.slice(0, 10) || ''} onChange={set('drugLicenseValidTill')} /></Field>
            <Field label="Payment terms (days)"><input type="number" value={edit.paymentTermsDays || ''} onChange={set('paymentTermsDays')} /></Field>
            <Field label="Address" full><input value={edit.address?.line1 || ''} onChange={setAddr('line1')} /></Field>
            <Field label="City"><input value={edit.address?.city || ''} onChange={setAddr('city')} /></Field>
            <Field label="District"><input value={edit.address?.district || ''} onChange={setAddr('district')} /></Field>
            <Field label="PIN"><input value={edit.address?.pincode || ''} onChange={setAddr('pincode')} /></Field>
            <Field label="Notes" full><textarea value={edit.notes || ''} onChange={set('notes')} /></Field>
          </div>
          <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={edit.active !== false} onChange={set('active')} />Active</label>
          <ErrorBox error={error} />
          <div className="row end"><button className="btn" onClick={save}>Save supplier</button></div>
        </Modal>
      )}
    </>
  );
}
