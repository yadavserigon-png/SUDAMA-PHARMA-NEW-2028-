import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useToast } from '../../state/toast';
import { DataTable, ErrorBox, Field, Modal, PageHead } from '../../components/ui';

export default function Categories() {
  const toast = useToast();
  const { data, reload } = useApi('/categories?flat=true&all=true');
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const save = async () => {
    try {
      const body = { name: edit.name, parent: edit.parent || null, description: edit.description || undefined, discountPercent: Number(edit.discountPercent || 0), sortOrder: Number(edit.sortOrder || 0), active: edit.active !== false };
      if (edit._id) await api(`/categories/${edit._id}`, { method: 'PUT', body }); else await api('/categories', { method: 'POST', body });
      toast('Category saved');
      setEdit(null);
      reload();
    } catch (e) { setError(e); }
  };
  const byId = new Map((data || []).map((c) => [c._id, c]));
  return (
    <>
      <PageHead title="Categories" sub="Run 'npm run seed:base' in the backend once to create the standard pharmacy category tree.">
        <button className="btn" onClick={() => setEdit({ active: true })}>Add category</button>
      </PageHead>
      <DataTable rows={data} onRowClick={(c) => setEdit({ ...c, parent: c.parent || '' })} columns={[
        { title: 'Name', render: (c) => (c.parent ? `— ${c.name}` : <b>{c.name}</b>) },
        { title: 'Parent', render: (c) => byId.get(c.parent)?.name || '' },
        { title: 'Products', key: 'productCount', num: true },
        { title: 'Category offer', render: (c) => (c.discountPercent ? `${c.discountPercent}%` : ''), num: true },
        { title: 'Status', render: (c) => (c.active ? 'Active' : 'Hidden') },
      ]} />
      {edit && (
        <Modal title={edit._id ? 'Edit category' : 'Add category'} onClose={() => setEdit(null)}>
          <div className="stack">
            <Field label="Name"><input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Parent"><select value={edit.parent || ''} onChange={(e) => setEdit({ ...edit, parent: e.target.value })}><option value="">Top level</option>{(data || []).filter((c) => !c.parent && c._id !== edit._id).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select></Field>
            <Field label="Description"><textarea value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="Category discount %" hint="not combined with product discounts"><input type="number" min="0" max="90" value={edit.discountPercent || 0} onChange={(e) => setEdit({ ...edit, discountPercent: e.target.value })} /></Field>
            <Field label="Sort order"><input type="number" value={edit.sortOrder || 0} onChange={(e) => setEdit({ ...edit, sortOrder: e.target.value })} /></Field>
            <label className="check"><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Visible to customers</label>
            <ErrorBox error={error} />
            <div className="row end"><button className="btn" onClick={save}>Save</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}
