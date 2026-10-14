import { Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../../lib/hooks';
import { publicUrl } from '../../lib/api';
import { label } from '../../lib/format';
import { ErrorBox, Loading, Status } from '../../components/ui';
import ProductCard, { AddToCart, PriceLine } from '../../components/ProductCard';

export default function Product() {
  const { id } = useParams();
  const { data: p, error } = useApi(`/products/${id}`);
  if (error) return <div className="section"><ErrorBox error={error} /></div>;
  if (!p) return <Loading />;
  const anyStock = p.availability?.some((a) => a.status !== 'out_of_stock');
  const rows = [
    ['Brand', p.brand], ['Manufacturer', p.manufacturer], ['Marketed by', p.marketer], ['Composition', p.composition], ['Generic name', p.genericName],
    ['Strength', p.strength], ['Form', p.dosageForm && label(p.dosageForm)], ['Pack', p.packSize], ['GST', `${p.gstRate}% (included in price)`], ['Storage', p.storage],
  ].filter(([, v]) => v);
  return (
    <div className="section">
      <p className="muted"><Link to="/">Home</Link> / {p.category ? <Link to={`/search?category=${p.category._id}&title=${encodeURIComponent(p.category.name)}`}>{p.category.name}</Link> : 'Products'}</p>
      <div className="pd">
        <div className="pd-media">{p.images?.[0] ? <img src={publicUrl(p.images[0])} alt={p.name} /> : <span className="muted">No image yet</span>}</div>
        <div className="stack">
          <h1 style={{ fontSize: 'var(--step-3)' }}>{p.name}</h1>
          {p.manufacturer && <p className="muted-2" style={{ margin: 0 }}>by {p.manufacturer}</p>}
          {p.prescriptionRequired && <div className="notice warn">℞ Prescription required. Upload a valid prescription at checkout; our pharmacist verifies it before dispatch.</div>}
          {p.onlineSaleAllowed === false && <div className="notice error">This medicine is sold only at the store counter as per regulations.</div>}
          <div><PriceLine price={p.price} mrp={p.mrp} /></div>
          {p.quantityDiscounts?.length > 0 && <p className="muted">Buy more, save more: {p.quantityDiscounts.map((d) => `${d.percent}% off on ${d.minQty}+`).join(', ')}</p>}
          <div className="row">{anyStock ? <AddToCart product={{ ...p, stockStatus: 'in_stock' }} /> : <span className="badge red">Currently out of stock</span>}<Link to={`/request-medicine?name=${encodeURIComponent(p.name)}`}>Ask the pharmacist</Link></div>
          <dl className="kv">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
          <div className="panel tight">
            <b>Availability by store</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {p.availability?.map((a) => <li key={a.store._id}>{a.store.name} ({a.store.address?.city}) <Status value={a.status} /></li>)}
            </ul>
          </div>
        </div>
      </div>
      {(p.description || p.usage || p.sideEffects || p.safetyAdvice) && (
        <div className="grid grid-2 section">
          {p.description && <div className="panel"><h3>About</h3><p style={{ whiteSpace: 'pre-line' }}>{p.description}</p></div>}
          {p.usage && <div className="panel"><h3>Uses</h3><p style={{ whiteSpace: 'pre-line' }}>{p.usage}</p></div>}
          {p.sideEffects && <div className="panel"><h3>Side effects</h3><p style={{ whiteSpace: 'pre-line' }}>{p.sideEffects}</p></div>}
          {p.safetyAdvice && <div className="panel"><h3>Safety advice</h3><p style={{ whiteSpace: 'pre-line' }}>{p.safetyAdvice}</p></div>}
        </div>
      )}
      <p className="muted" style={{ fontSize: '0.85rem' }}>Information shown is for reference. Always follow your doctor's advice.</p>
      {p.substitutes?.length > 0 && (
        <section className="section">
          <h2>Alternatives with similar composition</h2>
          <p className="muted">{p.substituteNote}</p>
          <div className="product-grid">{p.substitutes.map((s) => <ProductCard key={s._id} p={s} />)}</div>
        </section>
      )}
    </div>
  );
}
