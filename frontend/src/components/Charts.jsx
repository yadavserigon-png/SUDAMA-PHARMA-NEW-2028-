import { inr, num } from '../lib/format';

/** Lightweight SVG line chart (no chart library). series: [{ name, color, values: number[] }] */
export function LineChart({ labels, series, height = 220, money = true }) {
  const W = 760;
  const H = height;
  const pad = { l: 64, r: 12, t: 12, b: 28 };
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const x = (i) => pad.l + (labels.length <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (labels.length - 1));
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.ceil(labels.length / 8);
  if (!labels.length) return <p className="muted">No sales in this period.</p>;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sales over time">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e6ece9" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end">{money ? `₹${num(Math.round(t))}` : num(Math.round(t))}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % every === 0 ? <text key={l + i} x={x(i)} y={H - 8} textAnchor="middle">{l}</text> : null))}
        {series.map((s) => (
          <g key={s.name}>
            <polyline fill="none" stroke={s.color} strokeWidth="2.5" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
            {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={s.color}><title>{`${s.name} ${labels[i]}: ${money ? inr(v) : num(v)}`}</title></circle>)}
          </g>
        ))}
      </svg>
      <figcaption className="row" style={{ fontSize: '0.85rem' }}>
        {series.map((s) => <span key={s.name}><span style={{ display: 'inline-block', width: 10, height: 10, background: s.color, borderRadius: 2, marginRight: 5 }} />{s.name}</span>)}
      </figcaption>
    </figure>
  );
}

/** Horizontal bars for rankings. rows: [{ label, value, sub }] */
export function Bars({ rows, money = true }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="muted">No data.</p>;
  return (
    <div>
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span title={r.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
          <div className="track"><div className="fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="num" style={{ textAlign: 'right' }}>{money ? inr(r.value) : num(r.value)}{r.sub ? <small className="muted"> {r.sub}</small> : null}</span>
        </div>
      ))}
    </div>
  );
}
