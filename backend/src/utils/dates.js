/** Store calendar dates (expiry, mfg) as UTC midnight of the given day. */
function toCalendarDate(v) {
  if (v === null || v === undefined || v === '') return v;
  if (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v)) {
    // "2027-06" (month/year on pack) => last day of that month
    const [y, m] = v.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0));
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00.000Z`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return d;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseRange(query = {}) {
  const to = query.to ? new Date(`${query.to}T23:59:59.999+05:30`) : new Date();
  const from = query.from ? new Date(`${query.from}T00:00:00.000+05:30`) : new Date(to.getTime() - 29 * 86400000);
  return { from, to };
}

module.exports = { toCalendarDate, parseRange };
