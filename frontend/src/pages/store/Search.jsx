import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi, qs } from '../../lib/hooks';
import ProductCard from '../../components/ProductCard';
import { Loading, ErrorBox, Pager } from '../../components/ui';

export default function Search() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const q = params.get('q') || '';
  const category = params.get('category') || '';
  const rx = params.get('rx') || '';
  const sort = params.get('sort') || '';
  const brand = params.get('brand') || '';
  useEffect(() => setPage(1), [q, category, rx, sort, brand]);
  const res = useApi(`/products${qs({ q, category, rx, sort, brand, page, limit: 24 })}`);
  const sponsored = useApi(category ? `/ads/active${qs({ placement: 'sponsored_product', category })}` : null);
  const facets = useApi('/products/facets');
  const set = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p); };
  const sponsoredIds = (sponsored.data || []).map((a) => a.product).filter(Boolean);
  const sponsoredProducts = useApi(sponsoredIds.length ? `/products?ids=${sponsoredIds.join(',')}` : null, [sponsoredIds.join(',')]);

  return (
    <div className="section">
      <h1 style={{ fontSize: 'var(--step-2)' }}>{q ? `Results for "${q}"` : params.get('title') || 'All products'}</h1>
      <div className="toolbar">
        <select value={rx} onChange={(e) => set('rx', e.target.value)} aria-label="Prescription filter">
          <option value="">All medicines</option>
          <option value="false">No prescription needed</option>
          <option value="true">Prescription medicines</option>
        </select>
        <select value={brand} onChange={(e) => set('brand', e.target.value)} aria-label="Brand">
          <option value="">Any brand</option>
          {(facets.data?.brands || []).map((b) => <option key={b}>{b}</option>)}
        </select>
        <select value={sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
          <option value="">Relevance</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="name">Name</option>
        </select>
        {res.data && <span className="muted">{res.data.total} products</span>}
      </div>
      <ErrorBox error={res.error} />
      {sponsoredProducts.data?.items?.length > 0 && (
        <div className="product-grid" style={{ marginBottom: 14 }}>{sponsoredProducts.data.items.slice(0, 2).map((p) => <ProductCard key={`s${p._id}`} p={p} sponsored />)}</div>
      )}
      {res.loading && !res.data ? <Loading /> : res.data?.items?.length ? (
        <div className="product-grid">{res.data.items.map((p) => <ProductCard key={p._id} p={p} />)}</div>
      ) : (
        <div className="panel">No products match. Try the generic name or salt, or <a href="/request-medicine">request this medicine</a>.</div>
      )}
      <Pager data={res.data} page={page} setPage={setPage} />
    </div>
  );
}
