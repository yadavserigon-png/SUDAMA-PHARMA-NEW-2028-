// Pure stock rules: sellability and FEFO (first-expiry-first-out) planning.

const DAY = 24 * 60 * 60 * 1000;

const BUSINESS_TZ = 'Asia/Kolkata';

/** Calendar day (YYYY-MM-DD) in the business timezone. */
function dayKey(d = new Date(), tz = BUSINESS_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

/** Midnight UTC of the business calendar day - a stable value for day arithmetic. */
function startOfDay(d = new Date()) {
  return new Date(`${dayKey(d)}T00:00:00.000Z`);
}

/** A batch may be sold only if active, not expired and has free (unreserved) quantity. */
function isBatchSellable(batch, now = new Date(), minShelfDays = 0) {
  if (!batch) return false;
  if (batch.status && batch.status !== 'active') return false; // recalled / quarantined / blocked
  if (!batch.expiryDate) return false;
  // Expiry is a calendar date: a batch expiring today (or within minShelfDays) is not sellable.
  const cutoff = startOfDay(new Date(startOfDay(now).getTime() + minShelfDays * DAY));
  if (startOfDay(batch.expiryDate) <= cutoff) return false;
  return (batch.qtyAvailable || 0) > 0;
}

/**
 * Plan allocation of qty across batches in FEFO order.
 * Returns { allocations: [{batchId, batchNo, expiryDate, qty, unitCost}], shortfall }
 */
function planFefo(batches, qty, now = new Date(), minShelfDays = 0) {
  const eligible = batches
    .filter((b) => isBatchSellable(b, now, minShelfDays))
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
  const allocations = [];
  let remaining = qty;
  for (const b of eligible) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, b.qtyAvailable);
    allocations.push({ batchId: b._id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: take, unitCost: b.costPerUnit ?? b.purchaseRate ?? 0 });
    remaining -= take;
  }
  return { allocations, shortfall: Math.max(0, remaining) };
}

/** Which configured alert thresholds a batch has crossed (e.g. [90, 60] days). */
function expiryBucket(expiryDate, now = new Date(), thresholds = [180, 90, 60, 30, 7]) {
  const days = Math.ceil((startOfDay(new Date(expiryDate)) - startOfDay(now)) / DAY);
  if (days <= 0) return { days, bucket: 'expired' };
  const sorted = [...thresholds].sort((a, b) => a - b);
  const hit = sorted.find((t) => days <= t);
  return { days, bucket: hit ? `${hit}d` : null };
}

module.exports = { DAY, BUSINESS_TZ, dayKey, startOfDay, isBatchSellable, planFefo, expiryBucket };
