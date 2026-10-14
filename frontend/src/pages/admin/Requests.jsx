import { useState } from 'react';
import { api, openProtected, fileUrl } from '../../lib/api';
import { useApi, qs } from '../../lib/hooks';
import { dateTime, label } from '../../lib/format';
import { useAdminStore } from '../../state/adminStore';
import { useSettings } from '../../state/settings';
import { useToast } from '../../state/toast';
import { DataTable, Field, Modal, PageHead, Pager, Status } from '../../components/ui';

export function Requests() {
  const { storeId, stores } = useAdminStore();
  const { whatsapp } = useSettings();
  const toast = useToast();
  const [status, setStatus] = useState('new');
  const [page, setPage] = useState(1);
  const { data, reload } = useApi(`/medicine-requests${qs({ storeId, status, page })}`);
  const [sel, setSel] = useState(null);
  const [f, setF] = useState({});
  const save = async () => {
    try {
      const r = await api(`/medicine-requests/${sel._id}`, { method: 'PUT', body: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== undefined)) });
      toast(r.messageStatus ? `Saved. WhatsApp: ${label(r.messageStatus)}` : 'Saved');
      setSel(null);
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  const waLink = (r) => `https://wa.me/91${r.phone}?text=${encodeURIComponent(`Hello ${r.name || ''}, this is Sudama Pharma about your request ${r.number}.`)}`;
  return (
    <>
      <PageHead title="Medicine requests" sub="From the website, phone and WhatsApp" />
      <div className="toolbar"><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">{['new', 'in_review', 'awaiting_customer', 'quoted', 'converted', 'unavailable', 'closed', ''].map((s) => <option key={s} value={s}>{s ? label(s) : 'All'}</option>)}</select></div>
      <DataTable rows={data?.items} onRowClick={(r) => { setSel(r); setF({}); }} empty="No requests." columns={[
        { title: 'Request', key: 'number' }, { title: 'When', render: (r) => dateTime(r.createdAt) }, { title: 'From', render: (r) => `${r.name || ''} ${r.phone}` }, { title: 'Source', render: (r) => label(r.source) },
        { title: 'Details', render: (r) => (r.text || '').slice(0, 80) }, { title: 'Photos', render: (r) => r.files?.length || '', num: true }, { title: 'Status', render: (r) => <Status value={r.status} /> },
      ]} />
      <Pager data={data} page={page} setPage={setPage} />
      {sel && (
        <Modal title={`Request ${sel.number}`} onClose={() => setSel(null)} wide>
          <div className="stack">
            <p><b>{sel.name}</b> · <a href={`tel:${sel.phone}`}>{sel.phone}</a> · PIN {sel.pincode || '-'} · <a href={waLink(sel)} target="_blank" rel="noreferrer">Open WhatsApp chat</a></p>
            <p style={{ whiteSpace: 'pre-line' }}>{sel.text}</p>
            <div className="row">{sel.files?.map((x, i) => <button key={x.path} className="btn ghost small" onClick={() => openProtected(fileUrl(x.path)).catch((e) => toast(e.message, 'error'))}>Photo {i + 1}</button>)}</div>
            {sel.notes?.length > 0 && <ul>{sel.notes.map((n, i) => <li key={i}><small className="muted">{dateTime(n.at)}</small> {n.text}</li>)}</ul>}
            <div className="form-grid">
              <Field label="Status"><select value={f.status || sel.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['new', 'in_review', 'awaiting_customer', 'quoted', 'converted', 'unavailable', 'closed'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
              <Field label="Handled by store"><select value={f.storeId || sel.store || ''} onChange={(e) => setF({ ...f, storeId: e.target.value })}><option value="">Not assigned</option>{stores.map((s) => <option key={s._id} value={s._id}>{s.code}</option>)}</select></Field>
              <Field label="Internal note" full><input value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
              {whatsapp.apiConfigured && <Field label="Send WhatsApp message to customer" full><textarea value={f.messageCustomer || ''} onChange={(e) => setF({ ...f, messageCustomer: e.target.value })} /></Field>}
            </div>
            <label className="check"><input type="checkbox" checked={Boolean(f.customerConfirmed)} onChange={(e) => setF({ ...f, customerConfirmed: e.target.checked })} />Customer confirmed the items and price</label>
            <label className="check"><input type="checkbox" checked={Boolean(f.assignToMe)} onChange={(e) => setF({ ...f, assignToMe: e.target.checked })} />Assign to me</label>
            <small className="muted">To fulfil: bill it at the POS counter, or ask the customer to order online, then set the status to Converted.</small>
            <div className="row end"><button className="btn" onClick={save}>Save</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function WhatsAppInbox() {
  const { whatsapp } = useSettings();
  const toast = useToast();
  const threads = useApi('/whatsapp/threads');
  const [phone, setPhone] = useState(null);
  const msgs = useApi(phone ? `/whatsapp/threads/${phone}` : null);
  const [text, setText] = useState('');
  const send = async () => {
    try { await api('/whatsapp/send', { method: 'POST', body: { to: phone, text } }); setText(''); msgs.reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <PageHead title="WhatsApp inbox" sub={whatsapp.apiConfigured ? 'Messages and photos received on the business number' : 'WhatsApp Business API is not configured yet'} />
      {!whatsapp.apiConfigured && <div className="notice warn" style={{ marginBottom: 12 }}>Automatic WhatsApp sync is off. Customers can use the click-to-chat link ({whatsapp.clickToChat}); staff record those requests manually under Medicine requests. See README → WhatsApp setup to connect the official API.</div>}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(220px, 1fr) 2fr' }}>
        <div className="panel tight">
          {(threads.data || []).map((t) => (
            <button key={t._id} className="btn ghost block" style={{ justifyContent: 'space-between', marginBottom: 6 }} onClick={() => setPhone(t._id)}>
              <span>+{t._id}</span>{t.unread > 0 && <span className="badge amber">{t.unread}</span>}
            </button>
          ))}
          {threads.data && !threads.data.length && <p className="muted">No conversations yet.</p>}
        </div>
        <div className="panel stack">
          {!phone && <p className="muted">Choose a conversation.</p>}
          {(msgs.data || []).map((m) => (
            <div key={m._id} style={{ alignSelf: m.direction === 'out' ? 'flex-end' : 'flex-start', maxWidth: '75%' }} className={`panel tight ${m.direction === 'out' ? '' : ''}`}>
              <small className="muted">{dateTime(m.createdAt)} {m.direction === 'out' ? `· ${m.sentBy?.name || 'system'} · ${m.status || ''}` : ''}</small>
              <div>{m.text}</div>
              {m.media?.path && <button className="linkbtn" onClick={() => openProtected(fileUrl(m.media.path))}>Open attachment</button>}
              {m.media && !m.media.path && <small className="muted">Attachment could not be downloaded</small>}
            </div>
          ))}
          {phone && whatsapp.apiConfigured && (
            <div className="row"><input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply (within 24 hours of the customer's last message)" aria-label="Message" /><button className="btn" disabled={!text} onClick={send}>Send</button></div>
          )}
        </div>
      </div>
    </>
  );
}
