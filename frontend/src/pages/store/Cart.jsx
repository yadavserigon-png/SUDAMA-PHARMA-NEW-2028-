import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, newKey } from '../../lib/api';
import { inr } from '../../lib/format';
import { useCart } from '../../state/cart';
import { useAuth } from '../../state/auth';
import { useSettings } from '../../state/settings';
import { useToast } from '../../state/toast';
import { QtyControl } from '../../components/ProductCard';
import { ErrorBox, Field } from '../../components/ui';

export function CartPage() {
  const cart = useCart();
  const nav = useNavigate();
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState(null);
  const items = useMemo(() => cart.items.map((i) => ({ productId: i.productId, qty: i.qty })), [cart.items]);
  const { user } = useAuth();
  useEffect(() => {
    if (!items.length || !user) { setQuote(null); return; }
    api('/orders/quote', { method: 'POST', body: { items } }).then((q) => { setQuote(q); setError(null); }).catch(setError);
  }, [items, user]);

  if (!cart.items.length) return <div className="section panel"><h2>Your cart is empty</h2><p><Link to="/search">Browse medicines</Link> or <Link to="/upload-prescription">upload a prescription</Link>.</p></div>;
  return (
    <div className="section grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(260px,1fr)', alignItems: 'start' }}>
      <div className="stack">
        <h1 style={{ fontSize: 'var(--step-2)' }}>Cart</h1>
        {cart.items.map((i) => (
          <div key={i.productId} className="panel tight row between">
            <div className="grow">
              <Link to={`/product/${i.productId}`}><b>{i.name}</b></Link>
              <div className="muted" style={{ fontSize: '0.85rem' }}>{i.packSize}{i.rx && <span className="rx-tag" style={{ marginLeft: 8 }}>℞ Prescription required</span>}</div>
            </div>
            <QtyControl value={i.qty} onChange={(q) => cart.setQty(i.productId, q)} />
            <b style={{ minWidth: 90, textAlign: 'right' }}>{inr((quote?.lines.find((l) => String(l.productId) === i.productId)?.lineTotal) ?? i.price * i.qty)}</b>
          </div>
        ))}
        <button className="linkbtn" onClick={cart.clear}>Empty cart</button>
      </div>
      <aside className="panel stack">
        <h3>Bill summary</h3>
        <ErrorBox error={error} />
        {!user && <div className="notice">Log in to see final prices and place the order.</div>}
        {quote && (
          <>
            <div className="row between"><span>MRP total</span><span>{inr(quote.mrpTotal)}</span></div>
            <div className="row between"><span>Discount</span><span>− {inr(quote.productDiscount)}</span></div>
            <div className="row between"><b>Items total</b><b>{inr(quote.subtotal)}</b></div>
            <small className="muted">Prices include GST. Delivery fee and coupons are applied at checkout.</small>
            {quote.prescriptionRequired && <div className="notice warn">Your cart has prescription medicines. You'll upload the prescription at checkout.</div>}
          </>
        )}
        <button className="btn block" onClick={() => nav(user ? '/checkout' : '/login?next=/checkout')}>{user ? 'Proceed to checkout' : 'Log in to checkout'}</button>
      </aside>
    </div>
  );
}

export function CheckoutPage() {
  const cart = useCart();
  const { user, refresh } = useAuth();
  const { payments } = useSettings();
  const toast = useToast();
  const nav = useNavigate();
  const [deliveryType, setDeliveryType] = useState('delivery');
  const [addressId, setAddressId] = useState(user?.addresses?.find((a) => a.isDefault)?._id || user?.addresses?.[0]?._id || 'new');
  const [addr, setAddr] = useState({ name: user?.name || '', phone: user?.phone || '', line1: '', line2: '', landmark: '', city: '', district: '', pincode: cart.pincode || '' });
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState('');
  const [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [rxFiles, setRxFiles] = useState([]);
  const [rxIds, setRxIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [idem] = useState(newKey);
  const items = useMemo(() => cart.items.map((i) => ({ productId: i.productId, qty: i.qty })), [cart.items]);
  const pin = addressId === 'new' ? addr.pincode : user?.addresses?.find((a) => a._id === addressId)?.pincode;

  useEffect(() => {
    api('/stores/public').then((s) => setStores(s)).catch(() => {});
  }, []);
  const [serviceable, setServiceable] = useState(null);
  useEffect(() => {
    if (deliveryType !== 'delivery' || !/^\d{6}$/.test(pin || '')) { setServiceable(null); return; }
    api(`/stores/serviceability?pincode=${pin}`).then(setServiceable).catch(() => setServiceable(null));
  }, [pin, deliveryType]);
  useEffect(() => {
    if (!items.length) return;
    api('/orders/quote', { method: 'POST', body: { items, couponCode: coupon || undefined, storeId: storeId || undefined } }).then(setQuote).catch(setError);
  }, [items, coupon, storeId]);

  if (!cart.items.length) return <div className="section panel">Your cart is empty. <Link to="/search">Browse medicines</Link></div>;

  const uploadRx = async () => {
    if (!rxFiles.length) return;
    const fd = new FormData();
    [...rxFiles].forEach((f) => fd.append('files', f));
    const p = await api('/prescriptions', { method: 'POST', form: fd });
    setRxIds((x) => [...x, p._id]);
    setRxFiles([]);
    toast('Prescription uploaded');
    return p._id;
  };

  const place = async () => {
    setBusy(true);
    setError(null);
    try {
      const ids = [...rxIds];
      if (quote?.prescriptionRequired && !ids.length) {
        if (!rxFiles.length) throw new Error('Please attach a photo or PDF of your prescription.');
        ids.push(await uploadRx());
      }
      if (deliveryType === 'pickup' && !storeId) throw new Error('Choose the store you will pick up from.');
      const body = {
        items, deliveryType, paymentMethod, couponCode: coupon || undefined, storeId: storeId || undefined, idempotencyKey: idem,
        prescriptionIds: ids.length ? ids : undefined,
      };
      if (deliveryType === 'delivery') {
        if (addressId === 'new') body.address = { ...addr, line2: addr.line2 || undefined, landmark: addr.landmark || undefined, district: addr.district || undefined };
        else body.addressId = addressId;
      }
      const order = await api('/orders/checkout', { method: 'POST', body });
      if (addressId === 'new' && deliveryType === 'delivery') {
        api('/auth/me/addresses', { method: 'POST', body: { ...body.address, label: 'Home' } }).then(refresh).catch(() => {});
      }
      cart.clear();
      if (paymentMethod === 'phonepe') {
        const pay = await api('/payments/phonepe/initiate', { method: 'POST', body: { orderId: order._id } });
        window.location.href = pay.redirectUrl;
        return;
      }
      toast('Order placed');
      nav(`/orders/${order._id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const setA = (k) => (e) => setAddr({ ...addr, [k]: e.target.value });
  return (
    <div className="section grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(280px,1fr)', alignItems: 'start' }}>
      <div className="stack">
        <h1 style={{ fontSize: 'var(--step-2)' }}>Checkout</h1>
        <div className="panel stack">
          <h3>1. How do you want it?</h3>
          <div className="row">
            <label className="check"><input type="radio" checked={deliveryType === 'delivery'} onChange={() => setDeliveryType('delivery')} />Home delivery</label>
            <label className="check"><input type="radio" checked={deliveryType === 'pickup'} onChange={() => setDeliveryType('pickup')} />Pick up from store</label>
          </div>
          {deliveryType === 'delivery' ? (
            <>
              {user?.addresses?.length > 0 && (
                <Field label="Deliver to">
                  <select value={addressId} onChange={(e) => setAddressId(e.target.value)}>
                    {user.addresses.map((a) => <option key={a._id} value={a._id}>{a.label}: {a.line1}, {a.city} {a.pincode}</option>)}
                    <option value="new">Add a new address</option>
                  </select>
                </Field>
              )}
              {addressId === 'new' && (
                <div className="form-grid">
                  <Field label="Full name"><input value={addr.name} onChange={setA('name')} required /></Field>
                  <Field label="Mobile"><input value={addr.phone} onChange={setA('phone')} inputMode="numeric" maxLength={10} required /></Field>
                  <Field label="House / street" full><input value={addr.line1} onChange={setA('line1')} required /></Field>
                  <Field label="Area / locality"><input value={addr.line2} onChange={setA('line2')} /></Field>
                  <Field label="Landmark"><input value={addr.landmark} onChange={setA('landmark')} /></Field>
                  <Field label="City / town"><input value={addr.city} onChange={setA('city')} required /></Field>
                  <Field label="District"><input value={addr.district} onChange={setA('district')} /></Field>
                  <Field label="PIN code"><input value={addr.pincode} onChange={setA('pincode')} inputMode="numeric" maxLength={6} required /></Field>
                </div>
              )}
              {serviceable && (serviceable.serviceable
                ? <div className="notice">We deliver to {pin} from {serviceable.stores.map((s) => s.store.name).join(', ')}.</div>
                : <div className="notice error">No store delivers to {pin} yet. Choose store pickup, or <Link to="/request-medicine">send a request</Link>.</div>)}
            </>
          ) : (
            <Field label="Pick up from">
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">Choose a store</option>
                {stores.map((s) => <option key={s._id} value={s._id}>{s.name}, {s.address.city}</option>)}
              </select>
            </Field>
          )}
        </div>

        {quote?.prescriptionRequired && (
          <div className="panel stack">
            <h3>2. Prescription</h3>
            <p className="muted">Upload a clear photo or PDF of a valid prescription. A registered pharmacist reviews it before your order is packed.</p>
            {rxIds.length ? <div className="notice">Prescription attached.</div> : (
              <input type="file" accept="image/*,application/pdf" capture="environment" multiple onChange={(e) => setRxFiles(e.target.files)} aria-label="Prescription file" />
            )}
          </div>
        )}

        <div className="panel stack">
          <h3>{quote?.prescriptionRequired ? '3' : '2'}. Payment</h3>
          {payments.codEnabled && <label className="check"><input type="radio" checked={paymentMethod === 'cod'} onChange={() => setPaymentMethod('cod')} />Cash on delivery / pay at store</label>}
          {payments.phonepeEnabled
            ? <label className="check"><input type="radio" checked={paymentMethod === 'phonepe'} onChange={() => setPaymentMethod('phonepe')} />UPI / cards via PhonePe</label>
            : <small className="muted">Online payment will be available soon.</small>}
        </div>
      </div>

      <aside className="panel stack">
        <h3>Order summary</h3>
        {cart.items.map((i) => <div key={i.productId} className="row between" style={{ fontSize: '0.9rem' }}><span>{i.name} × {i.qty}</span></div>)}
        <Field label="Coupon code"><input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Enter code" /></Field>
        {quote?.couponError && <small style={{ color: 'var(--danger)' }}>{quote.couponError}</small>}
        {quote && (
          <>
            <div className="row between"><span>MRP total</span><span>{inr(quote.mrpTotal)}</span></div>
            <div className="row between"><span>Product discount</span><span>− {inr(quote.productDiscount)}</span></div>
            {quote.couponDiscount > 0 && <div className="row between"><span>Coupon</span><span>− {inr(quote.couponDiscount)}</span></div>}
            <div className="row between"><b>To pay (before delivery fee)</b><b>{inr(quote.grandTotal)}</b></div>
            <small className="muted">The delivery fee of the assigned store is added on the final bill.</small>
          </>
        )}
        <ErrorBox error={error} />
        <button className="btn block" disabled={busy} onClick={place}>{busy ? 'Placing order…' : 'Place order'}</button>
        <small className="muted">By placing the order you agree to our <Link to="/policies">terms and return policy</Link>.</small>
      </aside>
    </div>
  );
}
