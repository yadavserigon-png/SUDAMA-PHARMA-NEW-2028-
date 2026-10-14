import { useState } from 'react';
import { api, openProtected, fileUrl } from '../../lib/api';
import { useApi, qs } from '../../lib/hooks';
import { dateTime } from '../../lib/format';
import { useAdminStore } from '../../state/adminStore';
import { useToast } from '../../state/toast';
import { DataTable, Field, Modal, PageHead, Pager, Status } from '../../components/ui';
import { OrderDetail } from './Orders';

export default function Prescriptions() {
  const { storeId } = useAdminStore();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const { data, reload } = useApi(`/prescriptions${qs({ storeId, status, page })}`);
  const [sel, setSel] = useState(null);
  const [order, setOrder] = useState(null);
  const [f, setF] = useState({ notes: '', doctorName: '', doctorRegNo: '', patientName: '', validTill: '' });
  const decide = async (decision) => {
    try {
      await api(`/prescriptions/${sel._id}/review`, { method: 'POST', body: { decision, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) } });
      toast(`Prescription ${decision}`);
      setSel(null);
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <PageHead title="Prescription review" sub="Every prescription is checked by a registered pharmacist. Nothing is approved automatically." />
      <div className="toolbar"><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="pending">Pending</option><option value="clarification">Needs clarification</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></select></div>
      <DataTable rows={data?.items} empty="No prescriptions in this list." columns={[
        { title: 'Uploaded', render: (p) => dateTime(p.createdAt) }, { title: 'Customer', render: (p) => `${p.customer?.name || ''} ${p.customer?.phone || ''}` },
        { title: 'Patient / doctor', render: (p) => `${p.patientName || '-'} / ${p.doctorName || '-'}` },
        { title: 'Files', render: (p) => p.files.map((f2, i) => <button key={f2.path} className="btn ghost small" onClick={() => openProtected(fileUrl(f2.path)).catch((e) => toast(e.message, 'error'))}>File {i + 1}</button>) },
        { title: 'Orders', render: (p) => p.orders?.map((o) => <button key={o._id} className="linkbtn" onClick={() => setOrder(o._id)}>{o.orderNumber} </button>) },
        { title: 'Status', render: (p) => <Status value={p.status} /> },
        { title: '', render: (p) => <button className="btn small" onClick={() => { setSel(p); setF({ notes: '', doctorName: p.doctorName || '', doctorRegNo: '', patientName: p.patientName || '', validTill: '' }); }}>Review</button> },
      ]} />
      <Pager data={data} page={page} setPage={setPage} />
      {sel && (
        <Modal title="Review prescription" onClose={() => setSel(null)}>
          <p className="muted">Open each file, check the prescriber details, date, patient and medicines. Orders linked to this prescription are approved from the order screen so stock and payment move together.</p>
          <div className="form-grid">
            <Field label="Patient name"><input value={f.patientName} onChange={(e) => setF({ ...f, patientName: e.target.value })} /></Field>
            <Field label="Doctor name"><input value={f.doctorName} onChange={(e) => setF({ ...f, doctorName: e.target.value })} /></Field>
            <Field label="Doctor reg. no."><input value={f.doctorRegNo} onChange={(e) => setF({ ...f, doctorRegNo: e.target.value })} /></Field>
            <Field label="Valid till"><input type="date" value={f.validTill} onChange={(e) => setF({ ...f, validTill: e.target.value })} /></Field>
            <Field label="Pharmacist notes" full><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          </div>
          <div className="row end" style={{ marginTop: 12 }}>
            <button className="btn danger" disabled={f.notes.length < 3} onClick={() => decide('rejected')}>Reject</button>
            <button className="btn warn" disabled={f.notes.length < 3} onClick={() => decide('clarification')}>Need clarification</button>
            <button className="btn" disabled={f.notes.length < 3} onClick={() => decide('approved')}>Approve</button>
          </div>
        </Modal>
      )}
      {order && <OrderDetail id={order} onClose={() => setOrder(null)} onChanged={reload} />}
    </>
  );
}
