import { Link } from 'react-router-dom';
import { inr } from '../lib/format';
import { publicUrl } from '../lib/api';
import { useCart } from '../state/cart';

export function PriceLine({ price, mrp }) {
  const off = mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
  return (
    <span>
      <span className="price">{inr(price)}</span>
      {off > 0 && <><span className="mrp">MRP {inr(mrp)}</span><span className="off">{off}% off</span></>}
      {off === 0 && <span className="muted" style={{ fontSize: '0.8rem', marginLeft: 4 }}>MRP</span>}
    </span>
  );
}

export function QtyControl({ value, onChange }) {
  return (
    <span className="qty">
      <button type="button" aria-label="Decrease" onClick={() => onChange(value - 1)}>−</button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label="Increase" onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}

export function AddToCart({ product }) {
  const cart = useCart();
  const qty = cart.qtyOf(product._id);
  if (product.stockStatus === 'out_of_stock') return <span className="badge red">Out of stock</span>;
  if (product.onlineSaleAllowed === false) return <span className="badge amber">In-store only</span>;
  if (qty) return <QtyControl value={qty} onChange={(q) => cart.setQty(product._id, q)} />;
  return <button className="btn small" onClick={() => cart.add(product)}>Add</button>;
}

export default function ProductCard({ p, sponsored }) {
  return (
    <article className={`pcard ${sponsored ? 'sponsored' : ''}`}>
      <Link to={`/product/${p._id}`} className="thumb" tabIndex={-1}>
        {p.images?.[0] ? <img src={publicUrl(p.images[0])} alt="" loading="lazy" /> : <span>{p.dosageForm ? p.dosageForm.replace('_', ' ') : 'Product'}<br />{p.packSize}</span>}
      </Link>
      {sponsored && <span className="sponsored-label">Sponsored</span>}
      <Link to={`/product/${p._id}`} className="name">{p.name}</Link>
      <div className="meta">
        {p.packSize && <div>{p.packSize}</div>}
        {p.manufacturer && <div>{p.manufacturer}</div>}
        {p.prescriptionRequired && <span className="rx-tag">℞ Prescription required</span>}
      </div>
      <div className="bottom">
        <PriceLine price={p.price} mrp={p.mrp} />
        <AddToCart product={p} />
      </div>
    </article>
  );
}
