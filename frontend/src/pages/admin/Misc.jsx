import { useState } from 'react';
import { api, download, openProtected, fileUrl, publicUrl } from '../../lib/api';
import { useApi, qs } from '../../lib/hooks';
import { inr, dateTime, label, today } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useAdminStore } from '../../state/adminStore';
import { useSettings } from '../../state/settings';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Field, Modal, PageHead, Pager, Status, Tabs } from '../../components/ui';

export function Support() {
  const { storeId } = useAdminStore();
  const toast = useToast();
  const staff = useApi('/users?role=staff&limit=200');
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const { data, reload } = useApi(`/support${qs({ storeId, status, page })}`);
  const [sel, setSel] = useState(null);
  const [msg, setMsg] = useState({ text: '', internal: false });
  const [upd, setUpd] = useState({});
  const open = async (t) => { setSel(await api(`/support/${t._id}`)); setUpd({}); };
  const send = async () => { try { setSel(await api(`/support/${sel._id}/messages`, { method: 'POST', body: msg })); setMsg({ text: '', internal: false }); } catch (e) { toast(e.message, 'error'); } };
  const save = async () => { try { setSel(await api(`/support/${sel._id}`, { method: 'PUT', body: upd })); toast('Ticket updated'); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <>
      <PageHead title="Support tickets" />
      <div className="toolbar"><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">{['open', 'in_progress', 'waiting_customer', 'resolved', 'closed', ''].map((s) => <option key={s} value={s}>{s ? label(s) : 'All'}</option>)}</select></div>
      <DataTable rows={data?.items} onRowClick={open} empty="No tickets." columns={[
        { title: 'Ticket', key: 'number' }, { title: 'Subject', key: 'subject' }, { title: 'Customer', render: (t) => `${t.name || ''} ${t.phone || ''}` }, { title: 'Category', render: (t) => label(t.category) },
        { title: 'Priority', render: (t) => <span className={`badge ${['urgent', 'high'].includes(t.priority) ? 'red' : ''}`}>{label(t.priority)}</span> }, { title: 'Assigned', render: (t) => t.assignedTo?.name }, { title: 'Updated', render: (t) => dateTime(t.updatedAt) }, { title: 'Status', render: (t) => <Status value={t.status} /> },
      ]} />
      <Pager data={data} page={page} setPage={setPage} />
      {sel && (
        <Modal title={`${sel.number} · ${sel.subject}`} onClose={() => setSel(null)} wide>
          <div className="stack">
            {sel.messages.map((m) => <div key={m._id} className="panel tight" style={m.internal ? { background: 'var(--haldi-soft)' } : undefined}><small className="muted">{m.byName} · {dateTime(m.at)}{m.internal ? ' · internal note' : ''}</small><div style={{ whiteSpace: 'pre-line' }}>{m.text}</div></div>)}
            <textarea value={msg.text} onChange={(e) => setMsg({ ...msg, text: e.target.value })} placeholder="Reply to the customer or add an internal note" aria-label="Message" />
            <div className="row between"><label className="check"><input type="checkbox" checked={msg.internal} onChange={(e) => setMsg({ ...msg, internal: e.target.checked })} />Internal note (customer cannot see)</label><button className="btn" disabled={!msg.text} onClick={send}>Send</button></div>
            <div className="form-grid">
              <Field label="Status"><select value={upd.status || sel.status} onChange={(e) => setUpd({ ...upd, status: e.target.value })}>{['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
              <Field label="Priority"><select value={upd.priority || sel.priority} onChange={(e) => setUpd({ ...upd, priority: e.target.value })}>{['low', 'medium', 'high', 'urgent'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
              <Field label="Assigned to"><select value={upd.assignedTo || sel.assignedTo || ''} onChange={(e) => setUpd({ ...upd, assignedTo: e.target.value || null })}><option value="">Unassigned</option>{(staff.data?.items || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}</select></Field>
              <Field label="Resolution" full><input value={upd.resolution ?? sel.resolution ?? ''} onChange={(e) => setUpd({ ...upd, resolution: e.target.value })} /></Field>
            </div>
            <div className="row end"><button className="btn secondary" onClick={save}>Update ticket</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function Ads() {
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState(can('ads.manage') ? 'ads' : 'apps');
  const ads = useApi(can('ads.manage') ? '/ads' : null);
  const apps = useApi('/ads/applications/list');
  const [sel, setSel] = useState(null);
  const [f, setF] = useState({});
  const [create, setCreate] = useState(null);
  const review = async () => { try { await api(`/ads/${sel._id}/review`, { method: 'POST', body: f }); toast('Saved'); setSel(null); ads.reload(); } catch (e) { toast(e.message, 'error'); } };
  const invoice = async (status) => { try { await api(`/ads/${sel._id}/invoice`, { method: 'POST', body: { amount: Number(f.amount || sel.budget || 0), status } }); toast('Invoice updated'); ads.reload(); } catch (e) { toast(e.message, 'error'); } };
  const appDecision = async (a, status) => {
    try { const r = await api(`/ads/applications/${a._id}`, { method: 'PUT', body: { status, reviewNotes: prompt('Notes for this decision (optional)') || undefined } }); toast(r.next || 'Saved'); apps.reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const submitAd = async () => {
    try {
      const fd = new FormData();
      Object.entries(create).forEach(([k, v]) => v && k !== 'file' && fd.append(k, v));
      if (create.file) fd.append('creative', create.file);
      await api('/ads', { method: 'POST', form: fd });
      toast('Campaign created - review it to make it live');
      setCreate(null); ads.reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <PageHead title="Advertising & partner applications">{can('ads.manage') && <button className="btn" onClick={() => setCreate({ placement: 'homepage_banner', title: '' })}>New campaign</button>}</PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[...(can('ads.manage') ? [{ value: 'ads', label: 'Campaigns' }] : []), { value: 'apps', label: 'Applications' }]} />
      {tab === 'ads' && (
        <DataTable rows={ads.data} onRowClick={(a) => { setSel(a); setF({ decision: a.status === 'submitted' ? 'approved' : a.status, complianceChecked: a.complianceChecked }); }} empty="No campaigns." columns={[
          { title: 'Campaign', key: 'title' }, { title: 'Advertiser', key: 'advertiserName' }, { title: 'Placement', render: (a) => label(a.placement) }, { title: 'Budget', render: (a) => inr(a.budget), num: true },
          { title: 'Impr.', key: 'impressions', num: true }, { title: 'Clicks', key: 'clicks', num: true }, { title: 'CTR', render: (a) => (a.impressions ? `${((a.clicks / a.impressions) * 100).toFixed(1)}%` : '-'), num: true },
          { title: 'Invoice', render: (a) => label(a.invoice?.status) }, { title: 'Status', render: (a) => <Status value={a.status} /> },
        ]} />
      )}
      {tab === 'apps' && (
        <DataTable rows={apps.data} empty="No applications." columns={[
          { title: 'When', render: (a) => dateTime(a.createdAt) }, { title: 'Type', render: (a) => label(a.type) }, { title: 'Name', render: (a) => `${a.name} · ${a.phone}` }, { title: 'Business', key: 'businessName' },
          { title: 'GST / licence', render: (a) => `${a.gstin || '-'} / ${a.licenseNo || '-'}` }, { title: 'Docs', render: (a) => a.documents?.map((d, i) => <button key={d.path} className="linkbtn" onClick={() => openProtected(fileUrl(d.path))}>{i + 1} </button>) },
          { title: 'Status', render: (a) => <Status value={a.status} /> },
          { title: '', render: (a) => ['new', 'under_review'].includes(a.status) && <span className="row"><button className="btn small" onClick={() => appDecision(a, 'approved')}>Approve</button><button className="btn ghost small" onClick={() => appDecision(a, 'rejected')}>Reject</button></span> },
        ]} />
      )}
      {sel && (
        <Modal title={sel.title} onClose={() => setSel(null)}>
          <div className="stack">
            {sel.creative && <img src={publicUrl(sel.creative)} alt="" style={{ maxHeight: 160 }} />}
            <p><b>{sel.headline}</b><br />{sel.body}<br /><small className="muted">{sel.linkUrl}</small></p>
            <Field label="Decision"><select value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })}>{['approved', 'rejected', 'paused', 'ended'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
            <label className="check"><input type="checkbox" checked={Boolean(f.complianceChecked)} onChange={(e) => setF({ ...f, complianceChecked: e.target.checked })} />I checked this ad: no cure claims, no prescription-drug promotion to the public, nothing misleading</label>
            <Field label="Notes"><input value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
            <div className="row end"><button className="btn" onClick={review}>Save decision</button></div>
            <hr />
            <Field label="Invoice amount (₹)"><input type="number" value={f.amount ?? sel.invoice?.amount ?? sel.budget ?? ''} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <div className="row"><button className="btn ghost" onClick={() => invoice('invoiced')}>Mark invoiced</button><button className="btn ghost" onClick={() => invoice('paid')}>Mark paid</button>{sel.invoice?.number && <span className="muted">Invoice {sel.invoice.number}</span>}</div>
          </div>
        </Modal>
      )}
      {create && (
        <Modal title="New campaign" onClose={() => setCreate(null)}>
          <div className="form-grid">
            <Field label="Title"><input value={create.title} onChange={(e) => setCreate({ ...create, title: e.target.value })} /></Field>
            <Field label="Advertiser name"><input value={create.advertiserName || ''} onChange={(e) => setCreate({ ...create, advertiserName: e.target.value })} /></Field>
            <Field label="Placement"><select value={create.placement} onChange={(e) => setCreate({ ...create, placement: e.target.value })}>{['homepage_banner', 'category_promotion', 'sponsored_product', 'delivery_recruitment', 'service_partner'].map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></Field>
            <Field label="Budget (₹)"><input type="number" value={create.budget || ''} onChange={(e) => setCreate({ ...create, budget: e.target.value })} /></Field>
            <Field label="Product ID" hint="sponsored product"><input value={create.product || ''} onChange={(e) => setCreate({ ...create, product: e.target.value })} /></Field>
            <Field label="Category ID" hint="category promotion"><input value={create.category || ''} onChange={(e) => setCreate({ ...create, category: e.target.value })} /></Field>
            <Field label="Headline" full><input value={create.headline || ''} onChange={(e) => setCreate({ ...create, headline: e.target.value })} /></Field>
            <Field label="Text" full><textarea value={create.body || ''} onChange={(e) => setCreate({ ...create, body: e.target.value })} /></Field>
            <Field label="Link"><input value={create.linkUrl || ''} onChange={(e) => setCreate({ ...create, linkUrl: e.target.value })} /></Field>
            <Field label="Starts"><input type="date" value={create.startAt || ''} onChange={(e) => setCreate({ ...create, startAt: e.target.value })} /></Field>
            <Field label="Ends"><input type="date" value={create.endAt || ''} onChange={(e) => setCreate({ ...create, endAt: e.target.value })} /></Field>
            <Field label="Creative image"><input type="file" accept="image/*" onChange={(e) => setCreate({ ...create, file: e.target.files[0] })} /></Field>
          </div>
          <div className="row end" style={{ marginTop: 10 }}><button className="btn" disabled={!create.title} onClick={submitAd}>Create</button></div>
        </Modal>
      )}
    </>
  );
}

export function WholesaleAdmin() {
  const { storeId } = useAdminStore();
  const toast = useToast();
  const { data, reload } = useApi(`/wholesale/quotations${qs({ storeId })}`);
  const [sel, setSel] = useState(null);
  const [prices, setPrices] = useState({});
  const [validTill, setValidTill] = useState(today(7));
  const quote = async () => {
    try { await api(`/wholesale/quotations/${sel._id}/quote`, { method: 'POST', body: { validTill, items: sel.items.map((i) => ({ itemId: i._id, unitPrice: Number(prices[i._id] ?? i.unitPrice) })) } }); toast('Quotation sent'); setSel(null); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <PageHead title="Wholesale" sub="Verify buyers in Users & roles → Wholesale buyers. Price quotations here." />
      <DataTable rows={data} onRowClick={(q2) => { setSel(q2); setPrices({}); }} empty="No quotation requests." columns={[
        { title: 'Number', key: 'number' }, { title: 'Buyer', render: (q2) => q2.buyer?.wholesale?.businessName || q2.buyer?.name }, { title: 'Store', render: (q2) => q2.store?.code },
        { title: 'Items', render: (q2) => q2.items.length, num: true }, { title: 'Total', render: (q2) => inr(q2.total), num: true }, { title: 'PO', key: 'buyerPoNumber' }, { title: 'Status', render: (q2) => <Status value={q2.status} /> },
      ]} />
      {sel && (
        <Modal title={`Quotation ${sel.number}`} onClose={() => setSel(null)}>
          <DataTable rows={sel.items} columns={[{ title: 'Item', key: 'name' }, { title: 'Qty', key: 'qty', num: true }, { title: 'Unit price', render: (i) => <input type="number" step="0.01" style={{ width: 110 }} value={prices[i._id] ?? i.unitPrice} onChange={(e) => setPrices({ ...prices, [i._id]: e.target.value })} aria-label="Unit price" disabled={!['requested', 'quoted'].includes(sel.status)} /> }]} />
          {['requested', 'quoted'].includes(sel.status) && <div className="row end" style={{ marginTop: 10 }}><Field label="Valid till"><input type="date" value={validTill} onChange={(e) => setValidTill(e.target.value)} /></Field><button className="btn" onClick={quote}>Send quotation</button></div>}
        </Modal>
      )}
    </>
  );
}

export function ImportExport() {
  const { can } = useAuth();
  const { storeId } = useAdminStore();
  const toast = useToast();
  const types = useApi('/io/types');
  const [type, setType] = useState('products');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState(null);
  const [from, setFrom] = useState(today(-29));
  const [to, setTo] = useState(today());
  const [error, setError] = useState(null);
  const def = types.data?.imports?.find((t) => t.type === type);
  const doPreview = async () => {
    setError(null); setResult(null);
    try { const fd = new FormData(); fd.append('file', file); setPreview(await api(`/io/preview/${type}`, { method: 'POST', form: fd })); setConfirm(false); } catch (e) { setError(e); }
  };
  const commit = async () => {
    try { setResult(await api(`/io/commit/${type}`, { method: 'POST', body: { token: preview.token, confirmUpdates: confirm } })); setPreview(null); toast('Import finished'); } catch (e) { setError(e); }
  };
  return (
    <>
      <PageHead title="Excel / CSV import & export" />
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        {can('import.manage') && (
          <div className="panel stack">
            <h3>Import</h3>
            <Field label="What to import"><select value={type} onChange={(e) => { setType(e.target.value); setPreview(null); setResult(null); }}>{(types.data?.imports || []).map((t) => <option key={t.type} value={t.type}>{label(t.type)}</option>)}</select></Field>
            {def && <small className="muted">Columns: {def.columns.join(', ')}{def.note ? `. ${def.note}` : ''}</small>}
            <button className="btn ghost" onClick={() => download(`/io/template/${type}`, `${type}-template.xlsx`)}>Download template</button>
            <input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files[0])} aria-label="Import file" />
            <button className="btn secondary" disabled={!file} onClick={doPreview}>Check file</button>
            <ErrorBox error={error} />
            {preview && (
              <div className="stack">
                <div className="notice">{preview.totalRows} rows · {preview.validRows} valid · {preview.newRecords} new · {preview.updates.length} existing · {preview.errors.length} with errors</div>
                {preview.errors.length > 0 && <DataTable rows={preview.errors} rowKey="row" columns={[{ title: 'Row', key: 'row', num: true }, { title: 'Problem', key: 'message' }]} />}
                {preview.updates.length > 0 && <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />Also update the {preview.updates.length} existing records{type === 'inventory' ? ' (adds the quantity on top of the existing batch)' : ''}</label>}
                <button className="btn" disabled={!preview.validRows} onClick={commit}>Import {confirm ? preview.validRows : preview.newRecords} records</button>
              </div>
            )}
            {result && <div className="notice">Created {result.created} · updated {result.updated} · skipped existing {result.skippedExisting} · failed {result.failed.length}{result.failed.length ? `: ${result.failed.map((x) => `row ${x.row} ${x.message}`).join('; ')}` : ''}</div>}
          </div>
        )}
        {can('export.data') && (
          <div className="panel stack">
            <h3>Export</h3>
            <p className="muted">Exports follow the store selected at the top. Dated exports use this range:</p>
            <div className="row"><Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
            {(types.data?.exports || []).map((t) => (
              <div key={t} className="row between"><span>{label(t)}</span><span className="row">
                <button className="btn ghost small" onClick={() => download(`/io/export/${t}${qs({ storeId, from, to })}`, `${t}.xlsx`).catch((e) => toast(e.message, 'error'))}>Excel</button>
                <button className="btn ghost small" onClick={() => download(`/io/export/${t}${qs({ storeId, from, to, format: 'csv' })}`, `${t}.csv`).catch((e) => toast(e.message, 'error'))}>CSV</button>
              </span></div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function Settings() {
  const { can } = useAuth();
  const toast = useToast();
  const { reload: reloadPublic } = useSettings();
  const [tab, setTab] = useState(can('settings.manage') ? 'branding' : 'payments');
  const { data, reload } = useApi(`/settings/${tab}`);
  const [f, setF] = useState(null);
  const v = f || data?.value || {};
  const set = (k) => (e) => setF({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value });
  const save = async () => { try { await api(`/settings/${tab}`, { method: 'PUT', body: v }); toast('Settings saved'); setF(null); reload(); reloadPublic(); } catch (e) { toast(e.message, 'error'); } };
  const upload = async (key, file) => { const fd = new FormData(); fd.append('file', file); try { const r = await api('/settings/upload/image', { method: 'POST', form: fd }); setF({ ...v, [key]: r.url }); } catch (e) { toast(e.message, 'error'); } };
  const text = (k, l, area) => <Field label={l} full={area}>{area ? <textarea value={v[k] || ''} onChange={set(k)} /> : <input value={v[k] || ''} onChange={set(k)} />}</Field>;
  return (
    <>
      <PageHead title="Settings" />
      <Tabs value={tab} onChange={(t) => { setTab(t); setF(null); }} tabs={[...(can('settings.manage') ? [{ value: 'branding', label: 'Branding & business' }, { value: 'policies', label: 'Policies' }, { value: 'inventory', label: 'Expiry alerts' }] : []), ...(can('payments.config') ? [{ value: 'payments', label: 'Payments' }] : [])]} />
      <div className="panel stack">
        {tab === 'branding' && (
          <div className="form-grid">
            {text('platformName', 'Platform name')}{text('legalName', 'Company legal name')}{text('founder', 'Founder')}{text('tagline', 'Tagline')}
            {text('phone', 'Contact phone')}{text('whatsapp', 'WhatsApp number')}{text('email', 'Contact email')}{text('cin', 'CIN')}{text('gstin', 'GSTIN')}
            {text('address', 'Registered address', true)}{text('footerText', 'Footer text', true)}{text('disclaimer', 'Medical disclaimer', true)}
            <Field label="Logo">{v.logo && <img src={publicUrl(v.logo)} alt="" style={{ height: 48 }} />}<input type="file" accept="image/*" onChange={(e) => e.target.files[0] && upload('logo', e.target.files[0])} /></Field>
          </div>
        )}
        {tab === 'policies' && <div className="form-grid">{text('returnPolicy', 'Return & refund policy', true)}{text('privacyPolicy', 'Privacy policy', true)}{text('terms', 'Terms of sale', true)}{text('shippingPolicy', 'Delivery policy', true)}</div>}
        {tab === 'inventory' && (
          <div className="form-grid">
            <Field label="Default expiry alert (days)"><input type="number" value={v.defaultExpiryAlertDays || 90} onChange={set('defaultExpiryAlertDays')} /></Field>
            <Field label="Alert levels (days)"><input value={(v.expiryAlertDays || []).join(', ')} onChange={(e) => setF({ ...v, expiryAlertDays: e.target.value.split(/[\s,]+/).map(Number).filter((n) => n > 0) })} /></Field>
            <Field label="Dead stock after (days without sale)"><input type="number" value={v.deadStockDays || 90} onChange={set('deadStockDays')} /></Field>
          </div>
        )}
        {tab === 'payments' && (
          <>
            {data?.gateway && <div className={`notice ${data.gateway.phonepeConfigured ? '' : 'warn'}`}>PhonePe: {data.gateway.phonepeConfigured ? `credentials loaded from server environment (${data.gateway.phonepeEnv}, ${data.gateway.apiVersion})` : 'PhonePe credentials are not set on the server. They are stored only in the backend .env, never in the database or browser.'}</div>}
            <div className="form-grid">
              <Field label="UPI ID (as verified by bank)"><input value={v.upiId || ''} onChange={set('upiId')} /></Field>
              <Field label="Payee name"><input value={v.upiPayeeName || ''} onChange={set('upiPayeeName')} /></Field>
              <Field label="Payment contact number"><input value={v.contactNumber || ''} onChange={set('contactNumber')} /></Field>
              <Field label="COD limit (₹)"><input type="number" value={v.codMaxAmount || 0} onChange={set('codMaxAmount')} /></Field>
              <Field label="Return window (days)"><input type="number" value={v.refundPolicyDays || 7} onChange={set('refundPolicyDays')} /></Field>
              <Field label="UPI QR code">{v.qrImage && <img src={publicUrl(v.qrImage)} alt="" style={{ height: 90 }} />}<input type="file" accept="image/*" onChange={(e) => e.target.files[0] && upload('qrImage', e.target.files[0])} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={Boolean(v.upiVerified)} onChange={set('upiVerified')} />I have verified this UPI ID and QR with a test payment into the company bank account</label>
            <label className="check"><input type="checkbox" checked={Boolean(v.codEnabled)} onChange={set('codEnabled')} />Cash on delivery enabled</label>
            <label className="check"><input type="checkbox" checked={Boolean(v.phonepeEnabled)} onChange={set('phonepeEnabled')} />Show PhonePe online payment at checkout (only works once server credentials are set)</label>
          </>
        )}
        <div className="row end"><button className="btn" onClick={save}>Save</button></div>
      </div>
    </>
  );
}

export function Audit() {
  const { storeId } = useAdminStore();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useApi(`/audit${qs({ storeId, action, page })}`);
  return (
    <>
      <PageHead title="Audit log" sub="Who did what, and when" />
      <div className="toolbar"><input placeholder="Action starts with, e.g. product. / refund. / pos." value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action filter" /></div>
      <DataTable rows={data?.items} columns={[
        { title: 'When', render: (a) => dateTime(a.createdAt) }, { title: 'User', render: (a) => `${a.userName || ''} (${label(a.role)})` }, { title: 'Action', key: 'action' },
        { title: 'Record', render: (a) => `${a.entity || ''} ${a.entityId || ''}` }, { title: 'Details', render: (a) => <code style={{ fontSize: '0.75rem' }}>{JSON.stringify(a.meta).slice(0, 160)}</code> }, { title: 'IP', key: 'ip' },
      ]} />
      <Pager data={data} page={page} setPage={setPage} />
    </>
  );
}

export function Notifications() {
  const { data, reload } = useApi('/notifications');
  const readAll = () => api('/notifications/read-all', { method: 'POST' }).then(reload);
  return (
    <>
      <PageHead title="Alerts"><button className="btn ghost" onClick={readAll}>Mark all read</button></PageHead>
      <DataTable rows={data?.items} empty="No alerts." columns={[
        { title: 'When', render: (n) => dateTime(n.createdAt) }, { title: 'Alert', render: (n) => <><b>{n.title}</b><br />{n.body}</> },
        { title: '', render: (n) => (n.link ? <a href={n.link}>Open</a> : '') }, { title: '', render: (n) => (n.read ? '' : <span className="badge amber">New</span>) },
      ]} />
    </>
  );
}
