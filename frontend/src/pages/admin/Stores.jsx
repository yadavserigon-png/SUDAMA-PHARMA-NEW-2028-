import { useCallback, useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useAuth } from '../../state/auth';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Field, Modal, PageHead } from '../../components/ui';
import { LocationPicker, MarkersMap } from '../../components/Maps';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const blank = {
  code: '', name: '', type: 'retail', address: { line1: '', line2: '', city: '', district: '', state: 'Bihar', pincode: '' }, location: null, deliveryRadiusKm: 5,
  serviceablePincodes: [], deliveryFee: 0, freeDeliveryAbove: 0, contact: { phone: '', email: '', whatsapp: '' },
  license: { retailDrugLicenseNo: '', wholesaleDrugLicenseNo: '', gstin: '', pharmacistName: '', pharmacistRegNo: '', validTill: '' },
  openingHours: DAYS.map((_, day) => ({ day, open: '08:00', close: '22:00', closed: false })), holidays: [], acceptsOnlineOrders: true, active: true, manager: '',
};

function StoreForm({ initial, onSaved, onClose }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({ ...blank, ...initial, address: { ...blank.address, ...initial?.address }, contact: { ...blank.contact, ...initial?.contact }, license: { ...blank.license, ...initial?.license, validTill: initial?.license?.validTill?.slice(0, 10) || '' }, manager: initial?.manager?._id || initial?.manager || '', openingHours: initial?.openingHours?.length ? initial.openingHours : blank.openingHours }));
  const [pins, setPins] = useState((initial?.serviceablePincodes || []).join(', '));
  const [holidays, setHolidays] = useState((initial?.holidays || []).map((h) => `${h.date?.slice(0, 10)} ${h.note || ''}`.trim()).join('\n'));
  const [error, setError] = useState(null);
  const managers = useApi('/users?role=store_manager,central_admin&limit=200');
  const set = (path) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    const [a, b] = path.split('.');
    setF((x) => (b ? { ...x, [a]: { ...x[a], [b]: v } } : { ...x, [a]: v }));
  };
  const onLoc = useCallback((loc) => setF((x) => ({ ...x, location: loc })), []);
  const save = async () => {
    setError(null);
    try {
      const body = {
        ...f,
        serviceablePincodes: pins.split(/[\s,]+/).filter(Boolean),
        holidays: holidays.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ date: l.slice(0, 10), note: l.slice(11) || undefined })),
        manager: f.manager || undefined,
        location: f.location?.lat ? f.location : undefined,
        license: { ...f.license, validTill: f.license.validTill || undefined },
        address: { ...f.address, line2: f.address.line2 || undefined },
      };
      ['_id', 'createdAt', 'updatedAt', '__v', 'staff', 'employees', 'deliveryZones'].forEach((k) => delete body[k]);
      if (initial?._id) { delete body.code; await api(`/stores/${initial._id}`, { method: 'PUT', body }); } else await api('/stores', { method: 'POST', body });
      toast('Store saved');
      onSaved();
    } catch (e) { setError(e); }
  };
  return (
    <Modal title={initial?._id ? `Edit ${initial.name}` : 'Add store'} onClose={onClose} wide>
      <div className="stack">
        <div className="form-grid">
          <Field label="Store code" hint="e.g. S1, CHAPRA-1"><input value={f.code} onChange={set('code')} disabled={Boolean(initial?._id)} /></Field>
          <Field label="Store name"><input value={f.name} onChange={set('name')} /></Field>
          <Field label="Type"><select value={f.type} onChange={set('type')}><option value="retail">Retail</option><option value="wholesale">Wholesale</option><option value="retail_wholesale">Retail + wholesale</option><option value="warehouse">Warehouse</option></select></Field>
          <Field label="Store manager"><select value={f.manager} onChange={set('manager')}><option value="">Not assigned</option>{(managers.data?.items || []).map((u) => <option key={u._id} value={u._id}>{u.name} ({u.phone})</option>)}</select></Field>
          <Field label="Address" full><input value={f.address.line1} onChange={set('address.line1')} /></Field>
          <Field label="Area"><input value={f.address.line2} onChange={set('address.line2')} /></Field>
          <Field label="City"><input value={f.address.city} onChange={set('address.city')} /></Field>
          <Field label="District"><input value={f.address.district} onChange={set('address.district')} /></Field>
          <Field label="State"><input value={f.address.state} onChange={set('address.state')} /></Field>
          <Field label="PIN code"><input value={f.address.pincode} onChange={set('address.pincode')} maxLength={6} /></Field>
          <Field label="Phone"><input value={f.contact.phone} onChange={set('contact.phone')} /></Field>
          <Field label="Email"><input value={f.contact.email} onChange={set('contact.email')} /></Field>
          <Field label="WhatsApp"><input value={f.contact.whatsapp} onChange={set('contact.whatsapp')} /></Field>
        </div>
        <h3>Location &amp; delivery area</h3>
        <p className="muted" style={{ margin: 0 }}>Click on the map to place the store. The orange circle is the delivery radius.</p>
        <LocationPicker value={f.location} radiusKm={f.deliveryRadiusKm} onChange={onLoc} />
        <div className="form-grid">
          <Field label="Latitude"><input type="number" step="0.000001" value={f.location?.lat ?? ''} onChange={(e) => onLoc({ lat: Number(e.target.value), lng: f.location?.lng ?? 0 })} /></Field>
          <Field label="Longitude"><input type="number" step="0.000001" value={f.location?.lng ?? ''} onChange={(e) => onLoc({ lat: f.location?.lat ?? 0, lng: Number(e.target.value) })} /></Field>
          <Field label="Delivery radius (km)"><input type="number" min="0" max="100" step="0.5" value={f.deliveryRadiusKm} onChange={set('deliveryRadiusKm')} /></Field>
          <Field label="Delivery fee (₹)"><input type="number" min="0" value={f.deliveryFee} onChange={set('deliveryFee')} /></Field>
          <Field label="Free delivery above (₹)" hint="0 = never"><input type="number" min="0" value={f.freeDeliveryAbove} onChange={set('freeDeliveryAbove')} /></Field>
          <Field label="Serviceable PIN codes" full hint="comma separated"><input value={pins} onChange={(e) => setPins(e.target.value)} /></Field>
        </div>
        <h3>Opening hours</h3>
        <div className="grid grid-4">
          {f.openingHours.map((h, i) => (
            <div key={h.day} className="panel tight">
              <b>{DAYS[h.day]}</b>
              <label className="check" style={{ marginLeft: 8 }}><input type="checkbox" checked={h.closed} onChange={(e) => setF((x) => ({ ...x, openingHours: x.openingHours.map((y, j) => (j === i ? { ...y, closed: e.target.checked } : y)) }))} />Closed</label>
              {!h.closed && <div className="row" style={{ gap: 4 }}><input type="time" value={h.open} onChange={(e) => setF((x) => ({ ...x, openingHours: x.openingHours.map((y, j) => (j === i ? { ...y, open: e.target.value } : y)) }))} aria-label="Opens" /><input type="time" value={h.close} onChange={(e) => setF((x) => ({ ...x, openingHours: x.openingHours.map((y, j) => (j === i ? { ...y, close: e.target.value } : y)) }))} aria-label="Closes" /></div>}
            </div>
          ))}
        </div>
        <Field label="Holidays" hint="one per line: YYYY-MM-DD note"><textarea value={holidays} onChange={(e) => setHolidays(e.target.value)} /></Field>
        <h3>Licences</h3>
        <div className="form-grid">
          <Field label="Retail drug licence no."><input value={f.license.retailDrugLicenseNo} onChange={set('license.retailDrugLicenseNo')} /></Field>
          <Field label="Wholesale drug licence no."><input value={f.license.wholesaleDrugLicenseNo} onChange={set('license.wholesaleDrugLicenseNo')} /></Field>
          <Field label="GSTIN"><input value={f.license.gstin} onChange={set('license.gstin')} /></Field>
          <Field label="Registered pharmacist"><input value={f.license.pharmacistName} onChange={set('license.pharmacistName')} /></Field>
          <Field label="Pharmacist reg. no."><input value={f.license.pharmacistRegNo} onChange={set('license.pharmacistRegNo')} /></Field>
          <Field label="Licence valid till"><input type="date" value={f.license.validTill} onChange={set('license.validTill')} /></Field>
        </div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={f.acceptsOnlineOrders} onChange={set('acceptsOnlineOrders')} />Accepts online orders</label>
          <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} />Store active</label>
        </div>
        <ErrorBox error={error} />
        <div className="row end"><button className="btn" onClick={save}>Save store</button></div>
      </div>
    </Modal>
  );
}

export default function Stores() {
  const { can, session } = useAuth();
  const { data, reload, error } = useApi('/stores');
  const [edit, setEdit] = useState(null);
  return (
    <>
      <PageHead title="Stores" sub={`${data?.length || 0} stores`}>
        {can('stores.manage') && session?.allStores && <button className="btn" onClick={() => setEdit({})}>Add store</button>}
      </PageHead>
      <ErrorBox error={error} />
      {data?.some((s) => s.location?.lat) && <MarkersMap markers={data.filter((s) => s.location?.lat).map((s) => ({ ...s.location, label: `${s.code} ${s.name}`, color: s.active ? '#1f6f4a' : '#7b8a83' }))} circles={data.filter((s) => s.location?.lat).map((s) => ({ ...s.location, radiusKm: s.deliveryRadiusKm }))} />}
      <div style={{ height: 12 }} />
      <DataTable rows={data} empty="No stores yet. Add your first store." onRowClick={can('stores.manage') ? (s) => setEdit(s) : undefined} columns={[
        { title: 'Code', key: 'code' }, { title: 'Name', key: 'name' }, { title: 'City', render: (s) => `${s.address.city}, ${s.address.district}` },
        { title: 'Radius', render: (s) => `${s.deliveryRadiusKm} km`, num: true }, { title: 'Manager', render: (s) => s.manager?.name || '-' },
        { title: 'Staff', render: (s) => Object.values(s.staff || {}).reduce((a, b) => a + b, 0), num: true },
        { title: 'Online', render: (s) => (s.acceptsOnlineOrders ? 'Yes' : 'No') }, { title: 'Status', render: (s) => (s.active ? <span className="badge green">Active</span> : <span className="badge red">Inactive</span>) },
      ]} />
      {edit && <StoreForm initial={edit._id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}
