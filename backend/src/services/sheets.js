// XLSX / CSV reading and writing.
const ExcelJS = require('exceljs');

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

const toCsvValue = (v) => {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // prevent spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const normHeader = (h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.text) return v.text;
    if (v.result !== undefined) return v.result;
    if (v.richText) return v.richText.map((r) => r.text).join('');
  }
  return v;
}

/** Returns [{ __row: n, header_a: value, ... }] */
async function readRows(buffer, filename) {
  let matrix;
  if (/\.csv$/i.test(filename)) {
    matrix = parseCsv(buffer.toString('utf8').replace(/^﻿/, ''));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    matrix = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      for (let c = 1; c <= ws.columnCount; c += 1) vals.push(cellValue(row.getCell(c).value));
      matrix.push(vals);
    });
  }
  if (!matrix.length) return [];
  const headers = matrix[0].map(normHeader);
  return matrix.slice(1).map((r, i) => {
    const o = { __row: i + 2 };
    headers.forEach((h, j) => { if (h) o[h] = typeof r[j] === 'string' ? r[j].trim() : r[j]; });
    return o;
  }).filter((o) => Object.keys(o).some((k) => k !== '__row' && o[k] !== '' && o[k] !== undefined));
}

async function sendWorkbook(res, { filename, sheets, format = 'xlsx' }) {
  if (format === 'csv') {
    const s = sheets[0];
    const lines = [s.columns.map((c) => toCsvValue(c.header)).join(',')];
    for (const r of s.rows) lines.push(s.columns.map((c) => toCsvValue(r[c.key])).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(`﻿${lines.join('\r\n')}`);
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sudama Pharma';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width || Math.max(12, c.header.length + 2) }));
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows) {
      const safe = {};
      for (const c of s.columns) {
        const v = r[c.key];
        safe[c.key] = typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v;
      }
      ws.addRow(safe);
    }
    if (s.note) {
      const n = wb.addWorksheet('Instructions');
      s.note.split('\n').forEach((line) => n.addRow([line]));
      n.getColumn(1).width = 120;
    }
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await wb.xlsx.write(res);
  return res.end();
}

module.exports = { parseCsv, toCsvValue, normHeader, readRows, sendWorkbook };
