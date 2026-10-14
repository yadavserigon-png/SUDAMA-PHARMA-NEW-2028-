import { useState } from 'react';
import { api, publicUrl } from '../../lib/api';
import { useApi, useDebounced, qs } from '../../lib/hooks';
import { inr, label } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useAdminStore } from '../../state/adminStore';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Field, Modal, PageHead, Pager, Status } from '../../components/ui';

const FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'injection', 'iv_fluid', 'cream', 'ointment', 'gel', 'drops', 'inhaler', 'powder', 'sachet', 'device', 'surgical', 'other'];
const TYPES = ['branded', 'generic', 'otc', 'surgical', 'device', 'personal_care', 'nutrition', 'other'];
const SCHEDULES = [['none', 'Not scheduled'], ['otc', 'OTC'], ['G', 'Schedule G'], ['H', 'Schedule H (Rx)'], ['H1', 'Schedule H1 (Rx + register)'], ['X', 'Schedule X (counter only)'], ['narcotic', 'Narcotic / NDPS (counter only)'], ['not_for_online', 'Not for online sale']];

export function ProductForm({ initial, onSaved, onClose }) {
  const toast = useToast();
  const cats = useApi('/categories?flat=true&all=true');
  const [f, setF] = useState(() => ({
    sku: '', name: '', genericName: '', brand: '', manufacturer: '', marketer: '', composition: '', strength: '', dosageForm: 'tablet', packSize: '', unitsPerStrip: 10, stripsPerBox: 1,
    category: '', subcategory: '', productType: 'branded', description: '', usage: '', sideEffects: '', safetyAdvice: '', storage: '', mrp: '', retailPrice: '', wholesalePrice: '', purchaseCost: '',
    minWholesaleQty: 1, gstRate: 12, hsnCode: '', discountPercent: 0, prescriptionRequired: false, scheduleClass: 'none', onlineSaleAllowed: true, coldChain: false, lowStockThreshold: 10,
    dataVerified: false, featured: false, active: true, barcodes: [], images: [], quantityDiscounts: [],
    ...initial,
    category: initial?.category?._id || initial?.category || '',
    subcategory: initial?.subcategory?._id || initial?.subcategory || '',
  }));
  const [barcodes, setBarcodes] = useState((initial?.barcodes || []).join(', '));
  const [slabs, setSlabs] = useState((initial?.quantityDiscounts || []).map((s) => `${s.minQty}:${s.percent}`).join(', '));
  const [error, setError] = useState(null);
  const [files, setFiles] = useState([]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    setError(null);
    try {
      const numKeys = ['mrp', 'retailPrice', 'wholesalePrice', 'purchaseCost', 'unitsPerStrip', 'stripsPerBox', 'minWholesaleQty', 'gstRate', 'discountPercent', 'lowStockThreshold'];
      const body = {};
      const allowed = ['sku', 'name', 'genericName', 'brand', 'manufacturer', 'marketer', 'composition', 'strength', 'dosageForm', 'packSize', 'category', 'subcategory', 'productType', 'description', 'usage', 'sideEffects', 'safetyAdvice', 'storage', 'hsnCode', 'scheduleClass', 'prescriptionRequired', 'onlineSaleAllowed', 'coldChain', 'dataVerified', 'featured', 'active', 'images', ...numKeys];
      for (const k of allowed) {
        let v = f[k];
        if (numKeys.includes(k)) v = v === '' || v === null || v === undefined ? undefined : Number(v);
        if (v === '' || v === undefined) continue;
        body[k] = v;
      }
      body.barcodes = barcodes.split(/[\s,]+/).filter(Boolean);
      body.quantityDiscounts = slabs.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [a, b] = s.split(':'); return { minQty: Number(a), percent: Number(b) }; });
      const p = initial?._id ? await api(`/products/${initial._id}`, { method: 'PUT', body }) : await api('/products', { method: 'POST', body });
      if (files.length) {
        const fd = new FormData();
        [...files].forEach((x) => fd.append('images', x));
        await api(`/products/${p._id}/images`, { method: 'POST', form: fd });
      }
      toast('Product saved');
      onSaved();
    } catch (e) { setError(e); }
  };
  const catOpts = (cats.data || []).map((c) => <option key={c._id} value={c._id}>{c.parent ? '— ' : ''}{c.name}</option>);
  return (
    <Modal title={initial?._id ? `Edit ${initial.name}` : 'Add product'} onClose={onClose} wide>
      <div className="notice warn" style={{ marginBottom: 12 }}>Enter details exactly as printed on the pack or supplier invoice. Do not guess compositions, barcodes or schedule classes.</div>
      <div className="form-grid">
        <Field label="SKU"><input value={f.sku} onChange={set('sku')} /></Field>
        <Field label="Medicine / product name"><input value={f.name} onChange={set('name')} /></Field>
        <Field label="Generic name"><input value={f.genericName} onChange={set('genericName')} /></Field>
        <Field label="Brand"><input value={f.brand} onChange={set('brand')} /></Field>
        <Field label="Manufacturer"><input value={f.manufacturer} onChange={set('manufacturer')} /></Field>
        <Field label="Marketed by"><input value={f.marketer} onChange={set('marketer')} /></Field>
        <Field label="Composition" full><input value={f.composition} onChange={set('composition')} /></Field>
        <Field label="Strength"><input value={f.strength} onChange={set('strength')} /></Field>
        <Field label="Dosage form"><select value={f.dosageForm} onChange={set('dosageForm')}>{FORMS.map((x) => <option key={x} value={x}>{label(x)}</option>)}</select></Field>
        <Field label="Pack size" hint="e.g. Strip of 10 tablets"><input value={f.packSize} onChange={set('packSize')} /></Field>
        <Field label="Units per strip"><input type="number" min="1" value={f.unitsPerStrip} onChange={set('unitsPerStrip')} /></Field>
        <Field label="Strips per box"><input type="number" min="1" value={f.stripsPerBox} onChange={set('stripsPerBox')} /></Field>
        <Field label="Barcodes / GTIN" hint="comma separated"><input value={barcodes} onChange={(e) => setBarcodes(e.target.value)} /></Field>
        <Field label="Category"><select value={f.category} onChange={set('category')}><option value="">None</option>{catOpts}</select></Field>
        <Field label="Subcategory"><select value={f.subcategory} onChange={set('subcategory')}><option value="">None</option>{catOpts}</select></Field>
        <Field label="Product type"><select value={f.productType} onChange={set('productType')}>{TYPES.map((x) => <option key={x} value={x}>{label(x)}</option>)}</select></Field>
        <Field label="Regulatory class"><select value={f.scheduleClass} onChange={set('scheduleClass')}>{SCHEDULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="MRP (₹, incl. GST)"><input type="number" step="0.01" value={f.mrp} onChange={set('mrp')} /></Field>
        <Field label="Selling price (₹)"><input type="number" step="0.01" value={f.retailPrice} onChange={set('retailPrice')} /></Field>
        <Field label="Wholesale price (₹)"><input type="number" step="0.01" value={f.wholesalePrice} onChange={set('wholesalePrice')} /></Field>
        <Field label="Purchase cost (₹)"><input type="number" step="0.01" value={f.purchaseCost} onChange={set('purchaseCost')} /></Field>
        <Field label="Min. wholesale qty"><input type="number" min="1" value={f.minWholesaleQty} onChange={set('minWholesaleQty')} /></Field>
        <Field label="GST %"><select value={f.gstRate} onChange={set('gstRate')}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}</select></Field>
        <Field label="HSN code"><input value={f.hsnCode} onChange={set('hsnCode')} /></Field>
        <Field label="Product discount %"><input type="number" min="0" max="90" value={f.discountPercent} onChange={set('discountPercent')} /></Field>
        <Field label="Quantity offers" hint="minQty:percent, e.g. 3:5, 10:10"><input value={slabs} onChange={(e) => setSlabs(e.target.value)} /></Field>
        <Field label="Low-stock alert at"><input type="number" min="0" value={f.lowStockThreshold} onChange={set('lowStockThreshold')} /></Field>
        <Field label="Storage"><input value={f.storage} onChange={set('storage')} /></Field>
        <Field label="Description" full><textarea value={f.description} onChange={set('description')} /></Field>
        <Field label="Uses" full><textarea value={f.usage} onChange={set('usage')} /></Field>
        <Field label="Side effects"><textarea value={f.sideEffects} onChange={set('sideEffects')} /></Field>
        <Field label="Safety advice"><textarea value={f.safetyAdvice} onChange={set('safetyAdvice')} /></Field>
        <Field label="Add images" full><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => setFiles(e.target.files)} /></Field>
      </div>
      {f.images?.length > 0 && <div className="row" style={{ marginTop: 8 }}>{f.images.map((src) => <span key={src} style={{ position: 'relative' }}><img src={publicUrl(src)} alt="" style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 6 }} /><button className="btn ghost small" onClick={() => setF({ ...f, images: f.images.filter((x) => x !== src) })}>Remove</button></span>)}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <label className="check"><input type="checkbox" checked={f.prescriptionRequired} onChange={set('prescriptionRequired')} />Prescription required</label>
        <label className="check"><input type="checkbox" checked={f.onlineSaleAllowed} onChange={set('onlineSaleAllowed')} />Allowed online</label>
        <label className="check"><input type="checkbox" checked={f.coldChain} onChange={set('coldChain')} />Cold chain</label>
        <label className="check"><input type="checkbox" checked={f.dataVerified} onChange={set('dataVerified')} />Data verified against pack</label>
        <label className="check"><input type="checkbox" checked={f.featured} onChange={set('featured')} />Featured on homepage</label>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} />Active</label>
      </div>
      <ErrorBox error={error} />
      <div className="row end" style={{ marginTop: 12 }}><button className="btn" onClick={save}>Save product</button></div>
    </Modal>
  );
}

export default function Products() {
  const { can } = useAuth();
  const { storeId } = useAdminStore();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rx, setRx] = useState('');
  const dq = useDebounced(q);
  const { data, reload, error } = useApi(`/products${qs({ q: dq, page, rx, includeInactive: 'true', storeId: storeId !== 'all' ? storeId : undefined, limit: 50, sort: 'name' })}`);
  const [edit, setEdit] = useState(null);
  const open = async (p) => setEdit(await api(`/products/${p._id}`));
  return (
    <>
      <PageHead title="Products" sub="Medicine catalogue shared by all stores">
        {can('products.manage') && <button className="btn" onClick={() => setEdit({})}>Add product</button>}
      </PageHead>
      <div className="toolbar">
        <input placeholder="Search name, brand, salt, SKU or barcode" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search products" style={{ minWidth: 300 }} />
        <select value={rx} onChange={(e) => setRx(e.target.value)} aria-label="Prescription filter"><option value="">All</option><option value="true">Prescription</option><option value="false">Non-prescription</option></select>
      </div>
      <ErrorBox error={error} />
      <DataTable rows={data?.items} onRowClick={can('products.manage') ? open : undefined} empty="No products yet. Add one, or import from Excel." columns={[
        { title: 'SKU', key: 'sku' },
        { title: 'Name', render: (p) => <>{p.name}{p.prescriptionRequired && <span className="rx-tag"> ℞</span>}<br /><small className="muted">{p.manufacturer}</small></> },
        { title: 'Category', key: 'categoryName' },
        { title: 'MRP', render: (p) => inr(p.mrp), num: true },
        { title: 'Price', render: (p) => inr(p.price), num: true },
        { title: 'Stock', render: (p) => p.stockQty, num: true },
        { title: 'Status', render: (p) => <><Status value={p.stockStatus} /> {!p.active && <span className="badge red">Inactive</span>} {!p.dataVerified && <span className="badge amber">Unverified data</span>}</> },
      ]} />
      <Pager data={data} page={page} setPage={setPage} />
      {edit && <ProductForm initial={edit._id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}
