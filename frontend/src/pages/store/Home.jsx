import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, publicUrl } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useSettings } from '../../state/settings';
import ProductCard from '../../components/ProductCard';
import { inr } from '../../lib/format';

function SponsoredBanner() {
  const { data } = useApi('/ads/active?placement=homepage_banner');
  const ad = data?.[0];
  useEffect(() => { if (ad) api(`/ads/${ad._id}/impression`, { method: 'POST' }).catch(() => {}); }, [ad]);
  if (!ad) return null;
  const click = () => api(`/ads/${ad._id}/click`, { method: 'POST' }).catch(() => {});
  return (
    <div className="ad-banner section">
      <div>
        <span className="sponsored-label">Sponsored · {ad.advertiserName}</span>
        <h3 style={{ margin: '6px 0 4px' }}>{ad.headline || ad.title}</h3>
        {ad.body && <p style={{ margin: 0 }}>{ad.body}</p>}
        {ad.linkUrl && <a href={ad.linkUrl} target="_blank" rel="noreferrer sponsored" onClick={click}>Learn more</a>}
      </div>
      {ad.creative && <img src={publicUrl(ad.creative)} alt="" />}
    </div>
  );
}

export default function Home() {
  const nav = useNavigate();
  const { branding } = useSettings();
  const [q, setQ] = useState('');
  const cats = useApi('/categories');
  const featured = useApi('/products?featured=true&limit=12');
  const latest = useApi('/products?sort=newest&limit=12');
  const offers = useApi('/coupons/offers');
  const products = featured.data?.items?.length ? featured.data.items : latest.data?.items;

  return (
    <>
      <section className="hero">
        <h1>Your medicines, from the pharmacy you trust in Bihar.</h1>
        <p className="lead">Search by medicine name, brand or salt. Order online, or upload your prescription and our pharmacist will do the rest.</p>
        <div className="rx-slip">
          <div className="rx-mark" aria-hidden="true">℞</div>
          <form onSubmit={(e) => { e.preventDefault(); nav(`/search?q=${encodeURIComponent(q.trim())}`); }} role="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Paracetamol 500, Azithromycin, Dolo" aria-label="Search medicines" />
          </form>
          <div className="rx-actions">
            <button className="btn" onClick={() => nav(`/search?q=${encodeURIComponent(q.trim())}`)}>Search</button>
            <Link className="btn secondary" to="/upload-prescription">Upload prescription</Link>
          </div>
        </div>
        <div className="trust-row">
          <span>Licensed pharmacy stores</span>
          <span>Prescriptions checked by a pharmacist</span>
          <span>Batch &amp; expiry tracked on every strip</span>
          <span>Help on {branding.phone}</span>
        </div>
      </section>

      <SponsoredBanner />

      {offers.data?.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Offers</h2><Link to="/offers">All offers</Link></div>
          <div className="grid grid-3">
            {offers.data.slice(0, 3).map((o) => (
              <div className="panel" key={o._id}>
                <b>{o.title || `${o.type === 'percent' ? `${o.value}% off` : `${inr(o.value)} off`}`}</b>
                <p className="muted" style={{ margin: '4px 0' }}>{o.description}</p>
                <span className="badge amber">Code {o.code}</span>{o.minOrder ? <small> on orders above {inr(o.minOrder)}</small> : null}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2>Shop by category</h2></div>
        <div className="cat-grid">
          {(cats.data || []).map((c) => (
            <Link key={c._id} to={`/search?category=${c._id}&title=${encodeURIComponent(c.name)}`} className="cat-tile">
              {c.name}
              <small className="muted">{c.productCount ? `${c.productCount} products` : c.children?.length ? `${c.children.length} sections` : 'Coming soon'}</small>
            </Link>
          ))}
          {cats.data && !cats.data.length && <p className="muted">Categories will appear here once the catalogue is set up.</p>}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>{featured.data?.items?.length ? 'Popular at our stores' : 'Recently added'}</h2><Link to="/search">Browse all</Link></div>
        {products?.length ? (
          <div className="product-grid">{products.map((p) => <ProductCard key={p._id} p={p} />)}</div>
        ) : (
          <div className="panel">
            <p style={{ margin: 0 }}>The online catalogue is being set up. Can't find your medicine? <Link to="/request-medicine">Send us a request</Link> and we'll arrange it.</p>
          </div>
        )}
      </section>

      <section className="section grid grid-3">
        <div className="panel"><h3>Have a prescription?</h3><p className="muted">Take a photo and upload it. A registered pharmacist checks it before any prescription medicine is packed.</p><Link to="/upload-prescription">Upload now</Link></div>
        <div className="panel"><h3>Medicine not listed?</h3><p className="muted">Tell us what you need, attach a photo of the strip, and we'll call you back.</p><Link to="/request-medicine">Request a medicine</Link></div>
        <div className="panel"><h3>For clinics and chemists</h3><p className="muted">Licensed buyers get wholesale prices, quotations and GST invoices.</p><Link to="/wholesale">Wholesale portal</Link></div>
      </section>
    </>
  );
}
