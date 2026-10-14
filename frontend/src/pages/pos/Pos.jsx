// Counter billing. Works with USB/Bluetooth barcode scanners (they type + Enter into the scan box),
// phone/tablet cameras, and manual search. The server re-prices and re-validates every bill.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, newKey, openProtected } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { inr, monthYear, dateTime, label, today } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Field, Modal } from '../../components/ui';
import BarcodeScanner from '../../components/BarcodeScanner';
import { OrderDetail } from '../admin/Orders';

function ShiftPanel({ storeId, shift, onChange }) {
  const toast = useToast();
  const [cash, setCash] = useState('');
  const open = async () => { try { await api('/pos/shift/open', { method: 'POST', body: { storeId, openingCash: Number(cash || 0) } }); setCash(''); onChange(); } catch (e) { toast(e.message, 'error'); } };
  const close = async () => {
    try {
      const s = await api('/pos/shift/close', { method: 'POST', body: { storeId, countedCash: Number(cash || 0) } });
      toast(`Shift closed. Expected ${inr(s.expectedCash)}, counted ${inr(s.countedCash)}, difference ${inr(s.difference)}`);
      setCash('');
      onChange();
    } catch (e) { toast(e.message, 'error'); }
  };
  if (!shift) {
    return (
      <div className="panel stack" style={{ margin: 16 }}>
        <h2>Open your shift</h2>
        <p className="muted">Count the cash in the drawer before you start billing.</p>
        <Field label="Opening cash (₹)"><input type="number" min="0" value={cash} onChange={(e) => setCash(e.target.value)} /></Field>
        <button className="btn" onClick={open}>Open shift</button>
      </div>
    );
  }
  return (
    <details className="panel tight" style={{ margin: '8px 16px' }}>
      <summary>Shift since {dateTime(shift.openedAt)} · {shift.billCount} bills · cash sales {inr(shift.cashSales)} · digital {inr(shift.digitalSales)}</summary>
      <div className="row" style={{ marginTop: 8 }}>
        <Field label="Cash counted in drawer (₹)"><input type="number" min="0" value={cash} onChange={(e) => setCash(e.target.value)} /></Field>
        <button className="btn warn" onClick={close}>Close shift &amp; reconcile</button>
      </div>
    </details>
  );
}

function Receipt({ order, onClose }) {
  return (
    <Modal title={`Bill ${order.orderNumber}`} onClose={onClose}>
      <div className="receipt" id="receipt">
        <p style={{ textAlign: 'center', margin: 0 }}><b>Sudama Pharma</b><br />{dateTime(order.completedAt)}<br />Bill {order.orderNumber}</p>
        <table style={{ width: '100%' }}><tbody>
          {order.items.map((i) => <tr key={i._id}><td>{i.name}<br /><small>{i.allocations.map((a) => `B:${a.batchNo} E:${monthYear(a.expiryDate)}`).join(' ')}</small></td><td className="num">{i.qty} × {i.unitPrice.toFixed(2)}</td><td className="num">{i.lineTotal.toFixed(2)}</td></tr>)}
        </tbody></table>
        <p className="num" style={{ textAlign: 'right' }}>MRP {inr(order.mrpTotal)}<br />You saved {inr(order.productDiscount + order.couponDiscount)}<br /><b>Total {inr(order.grandTotal)}</b><br />GST incl. {inr(order.taxTotal)}<br />{label(order.payment.method)}{order.payment.cashTendered ? ` · paid ${inr(order.payment.cashTendered)} · change ${inr(order.payment.changeReturned)}` : ''}</p>
      </div>
      <div className="row end no-print">
        <button className="btn ghost" onClick={() => openProtected(`/orders/${order._id}/invoice.pdf?format=thermal`)}>80 mm PDF</button>
        <button className="btn ghost" onClick={() => openProtected(`/orders/${order._id}/invoice.pdf`)}>A4 tax invoice</button>
        <button className="btn" onClick={() => window.print()}>Print</button>
      </div>
    </Modal>
  );
}

export default function Pos() {
  const { session, can, user } = useAuth();
  const toast = useToast();
  const stores = session?.stores || [];
  const [storeId, setStoreId] = useState(() => { try { return localStorage.getItem('sp_pos_store') || stores[0]?._id || ''; } catch { return stores[0]?._id || ''; } });
  useEffect(() => { try { localStorage.setItem('sp_pos_store', storeId); } catch { /* ignore */ } }, [storeId]);
  const shift = useApi(storeId ? `/pos/shift/current?storeId=${storeId}` : null, [storeId]);
  const [code, setCode] = useState('');
  const [lines, setLines] = useState([]);
  const [results, setResults] = useState([]);
  const [warning, setWarning] = useState(null);
  const [camera, setCamera] = useState(false);
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [coupon, setCoupon] = useState('');
  const [method, setMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [rx, setRx] = useState({ verified: false, doctorName: '' });
  const [idem, setIdem] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [lookup, setLookup] = useState(null);
  const [report, setReport] = useState(null);
  const [register, setRegister] = useState(null);
  const scanRef = useRef(null);
  const lastScan = useRef({ code: '', at: 0 });

  const focusScan = () => setTimeout(() => scanRef.current?.focus(), 0);

  const addLine = useCallback((info) => {
    if (!info.stock) { setWarning(`${info.product.name}: no sellable stock in this store${info.blockedBatches?.length ? ` (${info.blockedBatches.map((b) => `${b.batchNo} ${b.status}`).join(', ')})` : ''}.`); return; }
    setLines((ls) => {
      const ex = ls.find((l) => l.productId === info.product._id);
      if (ex) {
        if (ex.qty + 1 > info.stock) { setWarning(`Only ${info.stock} units of ${info.product.name} in stock.`); return ls; }
        return ls.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...ls, { productId: info.product._id, name: info.product.name, packSize: info.product.packSize, rx: info.product.prescriptionRequired, schedule: info.product.scheduleClass, mrp: info.mrp, unitPrice: info.unitPrice, basePrice: info.unitPrice, gstRate: info.product.gstRate, stock: info.stock, batches: info.batches, batchId: info.suggestedBatch, qty: 1, blocked: info.blockedBatches }];
    });
    setWarning(info.blockedBatches?.length ? `Note: ${info.blockedBatches.length} expired/blocked batch(es) of ${info.product.name} are on record and will not be sold.` : null);
  }, []);

  const scan = useCallback(async (raw) => {
    const c = String(raw || '').trim();
    if (!c || !storeId) return;
    const now = Date.now();
    if (c === lastScan.current.code && now - lastScan.current.at < 800) return; // double-read guard
    lastScan.current = { code: c, at: now };
    setCode('');
    setResults([]);
    try {
      addLine(await api(`/pos/scan?storeId=${storeId}&code=${encodeURIComponent(c)}`));
    } catch (e) {
      if (e.status === 404 && e.body?.unknownBarcode) {
        setWarning(e.message);
        if (e.body.canRegister) setRegister({ code: c, q: '', results: [] });
      } else if (/^\d{8,14}$/.test(c)) setWarning(e.message);
      else {
        const r = await api(`/pos/search?storeId=${storeId}&q=${encodeURIComponent(c)}`).catch(() => []);
        if (r.length === 1) addLine(r[0]); else if (r.length) setResults(r); else setWarning(`No product found for "${c}".`);
      }
    }
    focusScan();
  }, [storeId, addLine]);

  useEffect(() => { focusScan(); }, [storeId]);

  const setQty = (i, q) => setLines((ls) => (q <= 0 ? ls.filter((_, j) => j !== i) : ls.map((l, j) => (j === i ? { ...l, qty: Math.min(q, l.stock) } : l))));
  const total = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const mrpTotal = lines.reduce((s, l) => s + l.mrp * l.qty, 0);
  const rxNeeded = lines.some((l) => l.rx);

  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        storeId,
        idempotencyKey: idem,
        items: lines.map((l) => ({ productId: l.productId, qty: l.qty, batchId: l.batchId || undefined, ...(l.unitPrice !== l.basePrice ? { unitPrice: l.unitPrice, overrideReason: l.overrideReason } : {}) })),
        customer: { name: customer.name || undefined, phone: customer.phone || undefined },
        couponCode: coupon || undefined,
        pharmacistVerified: rxNeeded ? rx.verified : undefined,
        doctorName: rx.doctorName || undefined,
        payment: { method, cashTendered: method === 'cash' && tendered ? Number(tendered) : undefined, reference: reference || undefined },
      };
      const order = await api('/pos/sale', { method: 'POST', body });
      setReceipt(order);
      setLines([]); setCustomer({ name: '', phone: '' }); setCoupon(''); setTendered(''); setReference(''); setRx({ verified: false, doctorName: '' });
      setIdem(newKey());
      shift.reload();
    } catch (e) { setError(e); } finally { setBusy(false); focusScan(); }
  };

  const findBill = async () => {
    const no = window.prompt('Bill / order number to return');
    if (!no) return;
    const r = await api(`/orders?q=${encodeURIComponent(no)}&storeId=${storeId}`).catch((e) => { toast(e.message, 'error'); return null; });
    if (r?.items?.[0]) setLookup(r.items[0]._id); else if (r) toast('Bill not found', 'error');
  };
  const openReport = async () => { try { setReport(await api(`/pos/daily-report?storeId=${storeId}&date=${today()}`)); } catch (e) { toast(e.message, 'error'); } };
  const cashRefunds = useApi(storeId ? `/refunds?storeId=${storeId}&status=approved` : null, [storeId, receipt]);
  const payRefund = async (r) => { try { await api('/pos/cash-refund', { method: 'POST', body: { storeId, amount: r.approvedAmount, refundId: r._id } }); toast('Cash refund paid'); cashRefunds.reload(); shift.reload(); } catch (e) { toast(e.message, 'error'); } };

  if (!stores.length) return <div className="container"><div className="notice error" style={{ marginTop: 20 }}>You are not assigned to any store.</div></div>;

  return (
    <div className="pos">
      <div className="pos-left">
        <div className="pos-head">
          <b>POS</b>
          <select value={storeId} onChange={(e) => { setStoreId(e.target.value); setLines([]); }} aria-label="Store">{stores.map((s) => <option key={s._id} value={s._id}>{s.code} · {s.name}</option>)}</select>
          <span style={{ marginLeft: 'auto' }}>{user?.name}</span>
          <button className="btn ghost small" style={{ color: '#fff' }} onClick={openReport}>Today's report</button>
          <button className="btn ghost small" style={{ color: '#fff' }} onClick={findBill}>Sales return</button>
          <Link className="btn ghost small" style={{ color: '#fff' }} to="/admin">Admin</Link>
        </div>
        <ShiftPanel storeId={storeId} shift={shift.data} onChange={shift.reload} />
        {shift.data && (
          <>
            <div className="pos-scan">
              <form className="row" onSubmit={(e) => { e.preventDefault(); scan(code); }}>
                <input ref={scanRef} className="grow" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan barcode or type medicine name, then Enter" aria-label="Scan or search" autoComplete="off" />
                <button className="btn secondary" type="button" onClick={() => setCamera(!camera)}>{camera ? 'Hide camera' : 'Camera'}</button>
              </form>
              {camera && <div style={{ marginTop: 8 }}><BarcodeScanner onDetected={scan} onClose={() => setCamera(false)} /></div>}
              {warning && <div className="notice warn" style={{ marginTop: 8 }}>{warning} <button className="linkbtn" onClick={() => setWarning(null)}>Dismiss</button></div>}
              {results.length > 0 && (
                <div className="panel tight" style={{ marginTop: 8 }}>
                  {results.map((r) => <div key={r.product._id} className="row between"><button className="linkbtn" onClick={() => { addLine(r); setResults([]); focusScan(); }}>{r.product.name} · {r.product.packSize}</button><span>{inr(r.unitPrice)} · stock {r.stock}</span></div>)}
                </div>
              )}
            </div>
            <div className="pos-lines">
              {!lines.length && <p className="muted" style={{ marginTop: 20 }}>Scan the first item to start a bill.</p>}
              {lines.length > 0 && (
                <table>
                  <thead><tr><th>Item</th><th>Batch</th><th className="num">MRP</th><th className="num">Price</th><th className="num">Qty</th><th className="num">Amount</th><th /></tr></thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.productId}>
                        <td>{l.name}{l.rx && <span className="rx-tag"> ℞</span>}<br /><small className="muted">{l.packSize} · GST {l.gstRate}%</small></td>
                        <td>
                          <select value={l.batchId || ''} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, batchId: e.target.value } : x)))} aria-label="Batch" style={{ minWidth: 150 }}>
                            {l.batches.map((b) => <option key={b._id} value={b._id}>{b.batchNo} · exp {monthYear(b.expiryDate)} · {b.qty}</option>)}
                          </select>
                        </td>
                        <td className="num">{inr(l.mrp)}</td>
                        <td className="num">
                          {can('pos.price_override') ? (
                            <input type="number" step="0.01" max={l.mrp} style={{ width: 90 }} value={l.unitPrice} onChange={(e) => {
                              const v = Number(e.target.value);
                              const reason = v !== l.basePrice && !l.overrideReason ? window.prompt('Reason for changing the price') : l.overrideReason;
                              setLines(lines.map((x, j) => (j === i ? { ...x, unitPrice: v, overrideReason: reason || undefined } : x)));
                            }} aria-label="Unit price" />
                          ) : inr(l.unitPrice)}
                        </td>
                        <td className="num"><span className="qty"><button type="button" onClick={() => setQty(i, l.qty - 1)} aria-label="Less">−</button><span>{l.qty}</span><button type="button" onClick={() => setQty(i, l.qty + 1)} aria-label="More">+</button></span></td>
                        <td className="num">{inr(l.unitPrice * l.qty)}</td>
                        <td><button className="linkbtn" onClick={() => setQty(i, 0)}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
      <div className="pos-right">
        <div className="pos-total">
          <div className="muted">MRP {inr(mrpTotal)} · saving {inr(mrpTotal - total)}</div>
          <div className="grand">{inr(total)}</div>
          <small className="muted">{lines.reduce((s, l) => s + l.qty, 0)} units · coupon applied on billing</small>
        </div>
        <div className="pos-pay stack">
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Customer name"><input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></Field>
            <Field label="Mobile"><input value={customer.phone} maxLength={10} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></Field>
          </div>
          <Field label="Coupon"><input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} /></Field>
          {rxNeeded && (
            <div className="notice warn stack">
              <b>Prescription medicine in bill</b>
              {can('prescriptions.review') ? (
                <>
                  <label className="check"><input type="checkbox" checked={rx.verified} onChange={(e) => setRx({ ...rx, verified: e.target.checked })} />I am the pharmacist and have checked a valid prescription</label>
                  <Field label="Prescriber (doctor) name"><input value={rx.doctorName} onChange={(e) => setRx({ ...rx, doctorName: e.target.value })} /></Field>
                </>
              ) : <span>Call the pharmacist to verify the prescription before billing.</span>}
            </div>
          )}
          <div className="pay-methods">
            {[['cash', 'Cash'], ['upi_pos', 'UPI'], ['card', 'Card'], ...(can('pos.price_override') ? [['credit', 'Credit']] : [])].map(([m, l]) => <button key={m} type="button" className={method === m ? 'active' : ''} onClick={() => setMethod(m)}>{l}</button>)}
          </div>
          {method === 'cash' && <Field label="Cash received (₹)"><input type="number" value={tendered} onChange={(e) => setTendered(e.target.value)} />{tendered && Number(tendered) >= total && <small>Change about {inr(Number(tendered) - total)}</small>}</Field>}
          {['upi_pos', 'card'].includes(method) && <Field label="Transaction reference" hint="from the payment terminal / UPI app after success"><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
          <ErrorBox error={error} />
          <button className="btn block" style={{ minHeight: 52, fontSize: '1.1rem' }} disabled={busy || !lines.length || !shift.data} onClick={complete}>{busy ? 'Billing…' : `Complete bill ${inr(total)}`}</button>
          {lines.length > 0 && <button className="btn ghost block" onClick={() => setLines([])}>Clear bill</button>}
          {cashRefunds.data?.items?.filter((r) => r.method === 'cash').length > 0 && (
            <div className="panel tight stack">
              <b>Approved cash refunds to pay</b>
              {cashRefunds.data.items.filter((r) => r.method === 'cash').map((r) => <div key={r._id} className="row between"><span>{r.order?.orderNumber} · {inr(r.approvedAmount)}</span><button className="btn small" onClick={() => payRefund(r)}>Pay out</button></div>)}
            </div>
          )}
        </div>
      </div>
      {receipt && <Receipt order={receipt} onClose={() => { setReceipt(null); focusScan(); }} />}
      {lookup && <OrderDetail id={lookup} onClose={() => setLookup(null)} />}
      {report && (
        <Modal title={`Counter report ${report.date}`} onClose={() => setReport(null)}>
          <p>Bills {report.totals.bills} · Sales {inr(report.totals.gross)} · Discounts {inr(report.totals.discount)} · GST {inr(report.totals.tax)} · Refunded {inr(report.totals.refunded)}</p>
          <DataTable rows={report.byMethod} rowKey="_id" columns={[{ title: 'Method', render: (r) => label(r._id) }, { title: 'Bills', key: 'bills', num: true }, { title: 'Amount', render: (r) => inr(r.amount), num: true }]} />
          <h3 style={{ marginTop: 12 }}>By cashier</h3>
          <DataTable rows={report.byCashier} rowKey="_id" columns={[{ title: 'Cashier', key: 'name' }, { title: 'Bills', key: 'bills', num: true }, { title: 'Amount', render: (r) => inr(r.amount), num: true }]} />
          <h3 style={{ marginTop: 12 }}>Shifts</h3>
          <DataTable rows={report.shifts} columns={[{ title: 'Cashier', render: (s) => s.user?.name }, { title: 'Opened', render: (s) => dateTime(s.openedAt) }, { title: 'Expected cash', render: (s) => inr(s.expectedCash ?? s.openingCash + s.cashSales - s.cashRefunds), num: true }, { title: 'Counted', render: (s) => (s.countedCash != null ? inr(s.countedCash) : 'open'), num: true }, { title: 'Difference', render: (s) => (s.difference != null ? inr(s.difference) : ''), num: true }]} />
        </Modal>
      )}
      {register && (
        <Modal title={`Register barcode ${register.code}`} onClose={() => setRegister(null)}>
          <p className="muted">Only map this barcode after checking the physical pack matches the product exactly.</p>
          <input placeholder="Search the product" value={register.q} onChange={async (e) => {
            const q = e.target.value;
            setRegister({ ...register, q });
            if (q.length > 1) { const r = await api(`/products?q=${encodeURIComponent(q)}&limit=8`).catch(() => ({ items: [] })); setRegister((x) => ({ ...x, results: r.items })); }
          }} aria-label="Product search" />
          {register.results.map((p) => (
            <div key={p._id} className="row between" style={{ marginTop: 6 }}>
              <span>{p.name} · {p.packSize} · {p.manufacturer}</span>
              <button className="btn small" onClick={async () => {
                try { await api(`/products/${p._id}/barcodes`, { method: 'POST', body: { code: register.code, verified: true } }); toast('Barcode registered'); setRegister(null); setWarning(null); lastScan.current = { code: '', at: 0 }; scan(register.code); } catch (err) { toast(err.message, 'error'); }
              }}>Pack matches - register</button>
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}
