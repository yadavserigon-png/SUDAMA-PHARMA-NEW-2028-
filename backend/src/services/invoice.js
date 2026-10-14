// PDF tax invoice (A4) and thermal receipt (80 mm) using PDFKit.
const PDFDocument = require('pdfkit');

const inr = (n) => `Rs. ${(Number(n) || 0).toFixed(2)}`;
const fmtDate = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

function invoicePdf(res, { order, store, branding, thermal = false }) {
  const width = thermal ? 226 : 595; // 80mm ≈ 226pt
  const doc = new PDFDocument({ size: thermal ? [width, 800] : 'A4', margin: thermal ? 10 : 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${order.orderNumber}.pdf"`);
  doc.pipe(res);
  const fs = thermal ? 7 : 9;
  const left = doc.page.margins.left;
  const usable = width - doc.page.margins.left - doc.page.margins.right;

  doc.fontSize(thermal ? 11 : 16).font('Helvetica-Bold').text(branding.platformName || 'Sudama Pharma', { align: 'center' });
  doc.fontSize(fs).font('Helvetica').text(branding.legalName || '', { align: 'center' });
  doc.text(`${store.name} (${store.code})`, { align: 'center' });
  doc.text([store.address?.line1, store.address?.city, store.address?.district, store.address?.pincode].filter(Boolean).join(', '), { align: 'center' });
  if (store.license?.retailDrugLicenseNo) doc.text(`DL No: ${store.license.retailDrugLicenseNo}`, { align: 'center' });
  if (store.license?.gstin || branding.gstin) doc.text(`GSTIN: ${store.license?.gstin || branding.gstin}`, { align: 'center' });
  if (store.contact?.phone) doc.text(`Ph: ${store.contact.phone}`, { align: 'center' });
  doc.moveDown(0.5).font('Helvetica-Bold').fontSize(fs + 1).text(order.channel === 'wholesale' ? 'TAX INVOICE (WHOLESALE)' : 'TAX INVOICE', { align: 'center' });
  doc.font('Helvetica').fontSize(fs);
  doc.text(`Invoice: ${order.orderNumber}`);
  doc.text(`Date: ${fmtDate(order.completedAt || order.createdAt)}`);
  if (order.customerName || order.customerPhone) doc.text(`Customer: ${order.customerName || ''} ${order.customerPhone || ''}`);
  if (order.address?.line1) doc.text(`Address: ${[order.address.line1, order.address.city, order.address.pincode].filter(Boolean).join(', ')}`);
  doc.moveDown(0.4);

  const cols = thermal
    ? [{ k: 'name', w: 0.46 }, { k: 'qty', w: 0.12 }, { k: 'rate', w: 0.2 }, { k: 'amt', w: 0.22 }]
    : [{ k: 'name', w: 0.34 }, { k: 'batch', w: 0.16 }, { k: 'exp', w: 0.1 }, { k: 'qty', w: 0.06 }, { k: 'mrp', w: 0.09 }, { k: 'rate', w: 0.09 }, { k: 'gst', w: 0.06 }, { k: 'amt', w: 0.1 }];
  const head = { name: 'Item', batch: 'Batch', exp: 'Exp', qty: 'Qty', mrp: 'MRP', rate: 'Rate', gst: 'GST%', amt: 'Amount' };
  const row = (vals, bold) => {
    const y = doc.y;
    let x = left;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
    let maxH = 0;
    for (const c of cols) {
      const w = c.w * usable;
      const txt = String(vals[c.k] ?? '');
      doc.text(txt, x, y, { width: w - 2, align: ['name', 'batch'].includes(c.k) ? 'left' : 'right' });
      maxH = Math.max(maxH, doc.heightOfString(txt, { width: w - 2 }));
      x += w;
    }
    doc.y = y + maxH + 2;
    doc.x = left;
  };
  row(head, true);
  doc.moveTo(left, doc.y).lineTo(left + usable, doc.y).stroke();
  for (const it of order.items) {
    const batches = (it.allocations || []).map((a) => a.batchNo).join(',');
    const exp = (it.allocations || [])[0]?.expiryDate ? new Date(it.allocations[0].expiryDate).toISOString().slice(0, 7) : '';
    row({ name: it.name, batch: batches, exp, qty: it.qty - (it.returnedQty || 0), mrp: (it.mrp || 0).toFixed(2), rate: (it.unitPrice || 0).toFixed(2), gst: it.gstRate, amt: (it.lineTotal || 0).toFixed(2) });
  }
  doc.moveTo(left, doc.y).lineTo(left + usable, doc.y).stroke();
  doc.moveDown(0.3);
  const line = (label, val, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(`${label}: ${val}`, { align: 'right' });
  };
  line('MRP Total', inr(order.mrpTotal));
  if (order.productDiscount) line('Discount', `- ${inr(order.productDiscount)}`);
  if (order.couponDiscount) line(`Coupon ${order.couponCode || ''}`, `- ${inr(order.couponDiscount)}`);
  if (order.deliveryFee) line('Delivery', inr(order.deliveryFee));
  line('GST included', inr(order.taxTotal));
  line('Grand Total', inr(order.grandTotal), true);
  if (order.refundedAmount) line('Refunded', inr(order.refundedAmount));
  doc.font('Helvetica').text(`Payment: ${order.payment?.method?.toUpperCase()} (${order.payment?.status})${order.payment?.reference ? ` Ref ${order.payment.reference}` : ''}`);
  if (order.payment?.cashTendered) doc.text(`Cash: ${inr(order.payment.cashTendered)}  Change: ${inr(order.payment.changeReturned)}`);

  // GST summary
  if (!thermal) {
    const byRate = {};
    for (const it of order.items) {
      byRate[it.gstRate] ||= { taxable: 0, tax: 0 };
      byRate[it.gstRate].taxable += it.taxableAmount || 0;
      byRate[it.gstRate].tax += it.taxAmount || 0;
    }
    doc.moveDown(0.5).font('Helvetica-Bold').text('GST Summary');
    doc.font('Helvetica');
    for (const [r, v] of Object.entries(byRate)) doc.text(`GST ${r}%: Taxable ${inr(v.taxable)}  CGST ${inr(v.tax / 2)}  SGST ${inr(v.tax / 2)}`);
  }
  doc.moveDown(0.8).fontSize(fs - 1).text('Medicines once sold are returnable only as per store return policy. Prescription medicines are dispensed against a valid prescription.', { align: 'center' });
  doc.text('Thank you for choosing Sudama Pharma.', { align: 'center' });
  doc.end();
}

module.exports = { invoicePdf };
