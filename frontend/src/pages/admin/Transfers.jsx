import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi, qs } from '../../lib/hooks';
import { dateTime } from '../../lib/format';
import { useAdminStore } from '../../state/adminStore';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Field, Modal, PageHead, Status } from '../../components/ui';
import { ProductPicker } from './Inventory';

export default function Transfers() {
  const toast = useToast();
  const { storeId, stores } = useAdminStore();
  const all = useApi('/stores/public');
  const { data, reload } = useApi(`/transfers${qs({ storeId })}`);
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ fromStore: '', toStore: '', notes: '' });
  const [items, setItems] = useState([]);
  const [pick, setPick] = useState(null);
  const [qty, setQty] = useState('');
  const [error, setError] = useState(null);
  const create = async () => {
    try {
      await api('/transfers', { method: 'POST', body: { ...f, notes: f.notes || undefined, items: items.map((i) => ({ product: i.product._id, qty: i.qty })) } });
      toast('Transfer requested');
      setShow(false); setItems([]); reload();
    } catch (e) { setError(e); }
  };
  const act = async (t, action) => {
    try { await api(`/transfers/${t._id}/${action}`, { method: 'POST', body: {} }); toast(`Transfer ${action === 'receive' ? 'received' : action === 'dispatch' ? 'dispatched' : 'cancelled'}`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <PageHead title="Stock transfers" sub="Move stock between stores. Batches and expiry dates travel with the stock."><button className="btn" onClick={() => setShow(true)}>New transfer</button></PageHead>
      <DataTable rows={data} empty="No transfers." columns={[
        { title: 'Number', key: 'number' }, { title: 'From', render: (t) => t.fromStore?.code }, { title: 'To', render: (t) => t.toStore?.code },
        { title: 'Items', render: (t) => t.items.map((i) => `${i.product?.name} × ${i.qty}`).join(', ') }, { title: 'Requested', render: (t) => dateTime(t.createdAt) },
        { title: 'Status', render: (t) => <Status value={t.status} /> },
        { title: '', render: (t) => <span className="row">
          {t.status === 'requested' && <button className="btn small" onClick={() => act(t, 'dispatch')}>Dispatch</button>}
          {t.status === 'requested' && <button className="btn ghost small" onClick={() => act(t, 'cancel')}>Cancel</button>}
          {t.status === 'dispatched' && <button className="btn small" onClick={() => act(t, 'receive')}>Mark received</button>}
        </span> },
      ]} />
      {show && (
        <Modal title="Request a stock transfer" onClose={() => setShow(false)}>
          <div className="stack">
            <div className="form-grid">
              <Field label="From store"><select value={f.fromStore} onChange={(e) => setF({ ...f, fromStore: e.target.value })}><option value="">Choose</option>{(all.data || []).map((s) => <option key={s._id} value={s._id}>{s.code} · {s.name}</option>)}</select></Field>
              <Field label="To store"><select value={f.toStore} onChange={(e) => setF({ ...f, toStore: e.target.value })}><option value="">Choose</option>{(all.data || []).map((s) => <option key={s._id} value={s._id}>{s.code} · {s.name}</option>)}</select></Field>
            </div>
            <div className="row" style={{ alignItems: 'end' }}>
              <div className="grow"><Field label="Product"><ProductPicker value={pick} onChange={setPick} /></Field></div>
              <Field label="Qty"><input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 90 }} /></Field>
              <button className="btn secondary" disabled={!pick || !qty} onClick={() => { setItems([...items, { product: pick, qty: Number(qty) }]); setPick(null); setQty(''); }}>Add</button>
            </div>
            {items.map((i, n) => <div key={n} className="row between"><span>{i.product.name} × {i.qty}</span><button className="linkbtn" onClick={() => setItems(items.filter((_, k) => k !== n))}>Remove</button></div>)}
            <Field label="Note"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
            <ErrorBox error={error} />
            <div className="row end"><button className="btn" disabled={!items.length} onClick={create}>Request transfer</button></div>
            {stores.length === 1 && <small className="muted">You can request stock from another store; their staff dispatch it.</small>}
          </div>
        </Modal>
      )}
    </>
  );
}
