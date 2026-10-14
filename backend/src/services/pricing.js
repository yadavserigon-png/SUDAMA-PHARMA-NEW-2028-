// Pricing, tax and coupon maths. Pure functions (no DB) so they are fully unit tested.
// Indian retail convention: MRP and selling prices are GST-inclusive.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Split a GST-inclusive amount into taxable value and tax. */
function splitInclusiveTax(amount, gstRate = 0) {
  const rate = Number(gstRate) || 0;
  const taxable = rate > 0 ? amount / (1 + rate / 100) : amount;
  return { taxable: round2(taxable), tax: round2(amount - taxable) };
}

/** Highest applicable quantity-slab discount (percent). */
function quantityDiscountPercent(product, qty) {
  let best = 0;
  for (const slab of product.quantityDiscounts || []) {
    if (qty >= slab.minQty && slab.percent > best) best = slab.percent;
  }
  return best;
}

/**
 * Unit selling price for a channel.
 * - Retail/online/POS: retailPrice (or MRP) minus the best of product/category/quantity discount (never stacked).
 * - Wholesale: wholesalePrice (tier price if configured), no retail discounts.
 * The price never exceeds MRP.
 */
function unitPrice(product, { channel = 'online', qty = 1, categoryDiscountPercent = 0, priceTier } = {}) {
  const mrp = Number(product.mrp) || 0;
  if (channel === 'wholesale') {
    const tier = priceTier && (product.tierPrices || []).find((t) => t.tier === priceTier);
    const base = tier ? tier.price : product.wholesalePrice || product.retailPrice || mrp;
    return { mrp, unitPrice: round2(Math.min(base, mrp || base)), discountPercent: 0, hasProductDiscount: false };
  }
  const base = Number(product.retailPrice) || mrp;
  const pct = Math.max(Number(product.discountPercent) || 0, Number(categoryDiscountPercent) || 0, quantityDiscountPercent(product, qty));
  const price = round2(base * (1 - pct / 100));
  return {
    mrp,
    unitPrice: Math.min(price, mrp || price),
    discountPercent: pct,
    hasProductDiscount: pct > 0 || (mrp > 0 && base < mrp),
  };
}

/**
 * Coupon evaluation.
 * ctx = { now, storeId, subtotal, items:[{productId, categoryId, lineTotal, hasProductDiscount}], userUsageCount, channel }
 */
function evaluateCoupon(coupon, ctx) {
  const now = ctx.now || new Date();
  if (!coupon || !coupon.active) return { ok: false, reason: 'Coupon is not active' };
  if (coupon.startAt && now < new Date(coupon.startAt)) return { ok: false, reason: 'Coupon is not yet valid' };
  if (coupon.endAt && now > new Date(coupon.endAt)) return { ok: false, reason: 'Coupon has expired' };
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) return { ok: false, reason: 'Coupon usage limit reached' };
  if (coupon.perUserLimit && (ctx.userUsageCount || 0) >= coupon.perUserLimit) {
    return { ok: false, reason: 'You have already used this coupon the maximum number of times' };
  }
  if (coupon.channels && coupon.channels.length && ctx.channel && !coupon.channels.includes(ctx.channel)) {
    return { ok: false, reason: 'Coupon not valid for this channel' };
  }
  const storeIds = (coupon.stores || []).map(String);
  if (storeIds.length && !storeIds.includes(String(ctx.storeId))) return { ok: false, reason: 'Coupon not valid for this store' };
  if (coupon.minOrder && ctx.subtotal < coupon.minOrder) {
    return { ok: false, reason: `Minimum order value is ₹${coupon.minOrder}` };
  }
  const prodIds = (coupon.products || []).map(String);
  const catIds = (coupon.categories || []).map(String);
  const eligible = ctx.items.filter((it) => {
    const restricted = prodIds.length > 0 || catIds.length > 0;
    if (restricted && !prodIds.includes(String(it.productId)) && !catIds.includes(String(it.categoryId))) return false;
    if (!coupon.stackWithProductDiscounts && it.hasProductDiscount) return false;
    return true;
  });
  const base = eligible.reduce((s, it) => s + it.lineTotal, 0);
  if (base <= 0) return { ok: false, reason: 'No eligible items for this coupon (offers cannot be combined)' };
  let discount = coupon.type === 'percent' ? (base * coupon.value) / 100 : Math.min(coupon.value, base);
  if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  return { ok: true, discount: round2(discount), eligibleBase: round2(base) };
}

/**
 * Build bill totals. lines: [{ unitPrice, mrp, qty, gstRate, ... }]
 * Coupon discount is apportioned to lines pro-rata so tax and net revenue stay correct.
 */
function computeTotals(lines, { couponDiscount = 0, deliveryFee = 0 } = {}) {
  const priced = lines.map((l) => ({ ...l, lineTotal: round2(l.unitPrice * l.qty), mrpTotal: round2((l.mrp || l.unitPrice) * l.qty) }));
  const subtotal = round2(priced.reduce((s, l) => s + l.lineTotal, 0));
  const mrpTotal = round2(priced.reduce((s, l) => s + l.mrpTotal, 0));
  const coupon = round2(Math.min(couponDiscount, subtotal));
  let allocated = 0;
  const out = priced.map((l, i) => {
    let share = subtotal > 0 ? round2((coupon * l.lineTotal) / subtotal) : 0;
    if (i === priced.length - 1) share = round2(coupon - allocated);
    allocated = round2(allocated + share);
    const net = round2(l.lineTotal - share);
    const { taxable, tax } = splitInclusiveTax(net, l.gstRate);
    return { ...l, couponShare: share, netAmount: net, taxableAmount: taxable, taxAmount: tax };
  });
  const taxTotal = round2(out.reduce((s, l) => s + l.taxAmount, 0));
  const productDiscount = round2(mrpTotal - subtotal);
  const grandTotal = round2(subtotal - coupon + (Number(deliveryFee) || 0));
  return { lines: out, mrpTotal, subtotal, productDiscount, couponDiscount: coupon, taxTotal, deliveryFee: round2(deliveryFee || 0), grandTotal };
}

module.exports = { round2, splitInclusiveTax, quantityDiscountPercent, unitPrice, evaluateCoupon, computeTotals };
