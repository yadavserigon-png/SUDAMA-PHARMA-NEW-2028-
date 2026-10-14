// Distance + serviceability. Pure functions.
function haversineKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 100) / 100;
}

/** A store serves a destination if its PIN is listed/zoned, or it lies within the delivery radius. */
function storeServes(store, { pincode, lat, lng } = {}) {
  if (!store.active || store.acceptsOnlineOrders === false) return { ok: false };
  const zone = (store.deliveryZones || []).find((z) => (z.pincodes || []).includes(pincode));
  if (zone) return { ok: true, reason: 'zone', fee: zone.fee, zone: zone.name };
  if (pincode && (store.serviceablePincodes || []).includes(pincode)) return { ok: true, reason: 'pincode', fee: store.deliveryFee || 0 };
  const distanceKm = haversineKm(store.location, lat != null && lng != null ? { lat, lng } : null);
  if (distanceKm != null && distanceKm <= (store.deliveryRadiusKm || 0)) return { ok: true, reason: 'radius', distanceKm, fee: store.deliveryFee || 0 };
  return { ok: false, distanceKm };
}

module.exports = { haversineKm, storeServes };
