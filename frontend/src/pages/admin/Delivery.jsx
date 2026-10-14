import { useEffect, useState } from 'react';
import { api, openProtected, fileUrl } from '../../lib/api';
import { useApi, qs } from '../../lib/hooks';
import { inr, dateTime, today, label } from '../../lib/format';
import { useAdminStore } from '../../state/adminStore';
import { useToast } from '../../state/toast';
import { DataTable, Field, PageHead, Status, Tabs, Modal } from '../../components/ui';
import { MarkersMap } from '../../components/Maps';

function Live({ storeId }) {
  const { data, reload } = useApi(`/delivery/active${qs({ storeId })}`);
  useEffect(() => { const t = setInterval(reload, 20000); return () => clearInterval(t); }, [reload]);
  const markers = (data || []).flatMap((a) => [
    ...(a.location ? [{ lat: a.location.lat, lng: a.location.lng, label: `${a.partner?.name} · ${a.order?.orderNumber} · ${dateTime(a.location.at)}`, color: '#d9930d' }] : []),
    ...(a.order?.address?.lat ? [{ lat: a.order.address.lat, lng: a.order.address.lng, label: `Customer ${a.order.customerName}` }] : []),
  ]);
  return (
    <div className="stack">
      <MarkersMap markers={markers} tall />
      <small className="muted">Only real GPS points sent by the partner's phone during an active delivery are shown. Location sharing stops automatically on delivery or failure.</small>
      <DataTable rows={data} empty="No active deliveries." columns={[
        { title: 'Order', render: (a) => a.order?.orderNumber }, { title: 'Partner', render: (a) => `${a.partner?.name} ${a.partner?.phone}` }, { title: 'Store', render: (a) => a.store?.code },
        { title: 'Status', render: (a) => <Status value={a.status} /> }, { title: 'Last location', render: (a) => (a.location ? dateTime(a.location.at) : a.trackingActive ? 'Waiting for GPS' : 'Not started') },
        { title: 'To customer', render: (a) => (a.distanceToCustomerKm != null ? `${a.distanceToCustomerKm} km` : '-') },
      ]} />
    </div>
  );
}

function Partners({ storeId }) {
  const toast = useToast();
  const { data, reload } = useApi(`/delivery/partners${qs({ storeId })}`);
  const [sel, setSel] = useState(null);
  const [f, setF] = useState({});
  const save = async () => {
    try { await api(`/users/${sel._id}/delivery`, { method: 'PUT', body: f }); toast('Partner updated'); setSel(null); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <p className="muted">Add delivery partners from Users &amp; roles (role: Delivery Partner), then approve them here after checking documents.</p>
      <DataTable rows={data} onRowClick={(p) => { setSel(p); setF({ approved: p.deliveryProfile?.approved, ratePerDelivery: p.deliveryProfile?.ratePerDelivery || 0, zones: p.deliveryProfile?.zones || [] }); }} empty="No delivery partners yet." columns={[
        { title: 'Name', key: 'name' }, { title: 'Phone', key: 'phone' }, { title: 'Stores', render: (p) => p.stores?.map((s) => s.code).join(', ') },
        { title: 'Vehicle', render: (p) => `${p.deliveryProfile?.vehicleType || ''} ${p.deliveryProfile?.vehicleNumber || ''}` }, { title: 'Docs', render: (p) => `${p.deliveryProfile?.documents?.filter((d) => d.verified).length || 0}/${p.deliveryProfile?.documents?.length || 0} verified` },
        { title: 'Approved', render: (p) => (p.deliveryProfile?.approved ? <span className="badge green">Approved</span> : <span className="badge amber">Pending</span>) },
        { title: 'Online', render: (p) => (p.deliveryProfile?.online ? 'Online' : 'Offline') }, { title: 'Active jobs', key: 'activeAssignments', num: true },
      ]} />
      {sel && (
        <Modal title={sel.name} onClose={() => setSel(null)}>
          <div className="stack">
            {(sel.deliveryProfile?.documents || []).map((d) => (
              <div key={d._id} className="row between"><span>{label(d.docType)} {d.verified && <span className="badge green">Verified</span>}</span>
                <span className="row"><button className="btn ghost small" onClick={() => openProtected(fileUrl(d.path))}>Open</button>{!d.verified && <button className="btn small" onClick={() => setF({ ...f, verifyDocumentId: d._id })}>Mark verified</button>}</span></div>
            ))}
            <label className="check"><input type="checkbox" checked={Boolean(f.approved)} onChange={(e) => setF({ ...f, approved: e.target.checked })} />Approved to take deliveries</label>
            <Field label="Pay per delivery (₹)"><input type="number" min="0" value={f.ratePerDelivery} onChange={(e) => setF({ ...f, ratePerDelivery: Number(e.target.value) })} /></Field>
            <Field label="Delivery zones / PIN codes" hint="comma separated"><input value={(f.zones || []).join(', ')} onChange={(e) => setF({ ...f, zones: e.target.value.split(/[\s,]+/).filter(Boolean) })} /></Field>
            <div className="row end"><button className="btn" onClick={save}>Save</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

function History({ storeId }) {
  const toast = useToast();
  const { data, reload } = useApi(`/delivery/assignments${qs({ storeId })}`);
  const settle = async (a) => {
    try { await api(`/delivery/assignments/${a._id}/settle-cod`, { method: 'POST', body: { amount: a.codCollected } }); toast('COD settled'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <DataTable rows={data} columns={[
      { title: 'Assigned', render: (a) => dateTime(a.createdAt) }, { title: 'Order', render: (a) => a.order?.orderNumber }, { title: 'Partner', render: (a) => a.partner?.name },
      { title: 'Status', render: (a) => <Status value={a.status} /> }, { title: 'Failure', key: 'failureReason' }, { title: 'Pay', render: (a) => inr(a.earnings + a.incentive), num: true },
      { title: 'COD', render: (a) => (a.codCollected ? <>{inr(a.codCollected)} {a.codSettled ? <span className="badge green">Settled</span> : <button className="btn small" onClick={() => settle(a)}>Mark received</button>}</> : '') },
    ]} />
  );
}

function Performance({ storeId }) {
  const [from, setFrom] = useState(today(-29));
  const [to, setTo] = useState(today());
  const { data } = useApi(`/delivery/performance${qs({ storeId, from, to })}`);
  return (
    <>
      <div className="toolbar"><Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      <DataTable rows={data?.partners} columns={[
        { title: 'Partner', key: 'name' }, { title: 'Assigned', key: 'assigned', num: true }, { title: 'Delivered', key: 'delivered', num: true }, { title: 'Failed', key: 'failed', num: true },
        { title: 'Avg minutes', key: 'avgMinutes', num: true }, { title: 'Earnings', render: (r) => inr(r.earnings), num: true }, { title: 'COD unsettled', render: (r) => inr(r.codUnsettled), num: true },
      ]} />
    </>
  );
}

export default function Delivery() {
  const { storeId } = useAdminStore();
  const [tab, setTab] = useState('live');
  return (
    <>
      <PageHead title="Delivery" sub="Assign packed orders from the Orders screen" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'live', label: 'Live map' }, { value: 'partners', label: 'Partners' }, { value: 'history', label: 'Assignments & COD' }, { value: 'perf', label: 'Performance' }]} />
      {tab === 'live' && <Live storeId={storeId} />}
      {tab === 'partners' && <Partners storeId={storeId} />}
      {tab === 'history' && <History storeId={storeId} />}
      {tab === 'perf' && <Performance storeId={storeId} />}
    </>
  );
}
