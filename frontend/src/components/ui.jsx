import { useEffect } from 'react';
import { label, statusColor } from '../lib/format';

export function Status({ value }) {
  if (!value) return null;
  return <span className={`badge ${statusColor(value)}`}>{label(value)}</span>;
}

export function Loading({ text = 'Loading…' }) {
  return <p className="muted" role="status">{text}</p>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="notice error" role="alert">{error.message || String(error)}</div>;
}

export function Empty({ children }) {
  return <div className="panel muted" style={{ textAlign: 'center' }}>{children}</div>;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label: l, hint, children, full }) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      {l} {hint && <span className="hint">({hint})</span>}
      {children}
    </label>
  );
}

export function Pager({ data, page, setPage }) {
  if (!data || data.pages <= 1) return null;
  return (
    <div className="pager">
      <span className="muted">{data.total} records</span>
      <button className="btn ghost small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page} of {data.pages}</span>
      <button className="btn ghost small" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</button>
    </div>
  );
}

/** columns: [{ key, title, render?(row), num? }] */
export function DataTable({ columns, rows, onRowClick, empty = 'Nothing here yet.', rowKey = '_id' }) {
  if (!rows) return <Loading />;
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key || c.title} className={c.num ? 'num' : ''}>{c.title}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r[rowKey] || i} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => <td key={c.key || c.title} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={value === t.value ? 'active' : ''} onClick={() => onChange(t.value)}>{t.label}</button>
      ))}
    </div>
  );
}

export function Kpi({ value, label: l, tone }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <div className="v">{value}</div>
      <div className="l">{l}</div>
    </div>
  );
}

export function PageHead({ title, children, sub }) {
  return (
    <div className="row between" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
      <div>
        <h1 style={{ fontSize: 'var(--step-2)', marginBottom: 2 }}>{title}</h1>
        {sub && <p className="muted" style={{ margin: 0 }}>{sub}</p>}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}
