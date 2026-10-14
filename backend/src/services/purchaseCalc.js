// Bulk purchase maths: boxes / strips / units, paid + free quantity, landed cost and margin.
// Pure functions so they are unit tested. Free goods lower the per-unit cost; they are never
// counted as purchase value or revenue, so profit is not overstated.

const { round2 } = require('./pricing');

/**
 * unitsPerPack: how many sellable units one purchase unit contains.
 *   purchaseUnit 'box'   -> stripsPerBox * unitsPerStrip (or unitsPerBox)
 *   purchaseUnit 'strip' -> unitsPerStrip
 *   purchaseUnit 'unit'  -> 1
 */
function unitsPerPurchaseUnit(product = {}, purchaseUnit = 'unit') {
  if (purchaseUnit === 'box') {
    if (product.unitsPerBox) return product.unitsPerBox;
    return (product.stripsPerBox || 1) * (product.unitsPerStrip || 1);
  }
  if (purchaseUnit === 'strip') return product.unitsPerStrip || 1;
  return 1;
}

/**
 * line = { paidQty, freeQty, rate (per purchase unit, ex-GST), discountPercent, gstRate,
 *          purchaseUnit, otherCharges (freight etc. ex-GST), mrp (per sellable unit),
 *          sellingPrice (per sellable unit, GST-inclusive) }
 */
function calcPurchaseLine(line, product = {}) {
  const paidQty = Number(line.paidQty) || 0;
  const freeQty = Number(line.freeQty) || 0;
  const rate = Number(line.rate) || 0;
  const discountPercent = Number(line.discountPercent) || 0;
  const gstRate = Number(line.gstRate ?? product.gstRate) || 0;
  const otherCharges = Number(line.otherCharges) || 0;
  const perPack = line.unitsPerPack || unitsPerPurchaseUnit(product, line.purchaseUnit || 'unit');

  const paidUnits = paidQty * perPack;
  const freeUnits = freeQty * perPack;
  const totalUnits = paidUnits + freeUnits;

  const grossAmount = paidQty * rate;
  const discountAmount = (grossAmount * discountPercent) / 100;
  const taxableAmount = grossAmount - discountAmount;
  const gstAmount = (taxableAmount * gstRate) / 100;
  const invoiceAmount = taxableAmount + gstAmount;
  const landedCost = taxableAmount + otherCharges; // ex-GST (GST is input credit for a registered business)

  const costPerUnit = totalUnits > 0 ? landedCost / totalUnits : 0;
  const costPerUnitInclTax = totalUnits > 0 ? (invoiceAmount + otherCharges) / totalUnits : 0;

  const sellingPrice = Number(line.sellingPrice) || 0;
  const sellingExTax = gstRate > 0 ? sellingPrice / (1 + gstRate / 100) : sellingPrice;
  const marginPerUnit = sellingPrice ? sellingExTax - costPerUnit : 0;

  return {
    unitsPerPack: perPack,
    paidUnits,
    freeUnits,
    totalUnits,
    grossAmount: round2(grossAmount),
    discountAmount: round2(discountAmount),
    taxableAmount: round2(taxableAmount),
    gstAmount: round2(gstAmount),
    invoiceAmount: round2(invoiceAmount),
    landedCost: round2(landedCost),
    costPerUnit: round2(costPerUnit),
    costPerUnitInclTax: round2(costPerUnitInclTax),
    mrp: Number(line.mrp) || 0,
    sellingPrice,
    marginPerUnit: round2(marginPerUnit),
    marginPercent: sellingExTax > 0 ? round2((marginPerUnit / sellingExTax) * 100) : 0,
    expectedGrossProfit: round2(marginPerUnit * totalUnits),
  };
}

function calcPurchaseTotals(lines, products = []) {
  const results = lines.map((l, i) => calcPurchaseLine(l, products[i] || {}));
  const sum = (k) => round2(results.reduce((s, r) => s + r[k], 0));
  return {
    lines: results,
    grossAmount: sum('grossAmount'),
    discountAmount: sum('discountAmount'),
    taxableAmount: sum('taxableAmount'),
    gstAmount: sum('gstAmount'),
    invoiceAmount: sum('invoiceAmount'),
    landedCost: sum('landedCost'),
    totalUnits: results.reduce((s, r) => s + r.totalUnits, 0),
    freeUnits: results.reduce((s, r) => s + r.freeUnits, 0),
  };
}

module.exports = { unitsPerPurchaseUnit, calcPurchaseLine, calcPurchaseTotals };
