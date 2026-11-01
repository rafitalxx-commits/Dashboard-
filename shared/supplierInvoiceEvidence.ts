// Deterministic document evidence, independent of browser locale or AI output.
const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
export function validInvoiceDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
}
export function parseInvoiceDate(value: string): string | null {
  const s = value.trim().replace(/^(?:issue\s*date|invoice\s*date|fecha\s*(?:de\s*)?(?:factura|emisi[oó]n))\s*:?\s*/i, "");
  let y: string, m: string, d: string;
  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const numeric = s.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  const english = s.match(/\b(?:(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?[,]?\s+(\d{4})|([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4}))\b/i);
  if (iso) [,y,m,d] = iso;
  else if (numeric) { [,d,m,y] = numeric; }
  else if (english) {
    d = english[1] || english[5]; y = english[3] || english[6];
    const name = (english[2] || english[4]).toLowerCase();
    const month = months.findIndex(x => x === name || (name.length === 3 && x.startsWith(name)) || (name === 'sept' && x === 'september'));
    if (month < 0) return null; m = String(month + 1);
  } else return null;
  const result = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  return validInvoiceDate(result) ? result : null;
}
export function invoiceDateInPdf(iso: string | null | undefined, pdf: string): boolean {
  if (!iso || !validInvoiceDate(iso)) return false;
  const rows = pdf.split(/\r?\n/);
  const labeled = rows.flatMap((row,i) => /(?:issue\s*date|invoice\s*date|fecha\s*(?:de\s*)?(?:factura|emisi[oó]n))/i.test(row) ? [row, rows[i+1] || ''] : []);
  return (labeled.length ? labeled : rows).some(row => parseInvoiceDate(row) === iso);
}
export function normalizeInvoiceVat(value: unknown): string {
  if (typeof value !== 'string' || /^(?:false|null|undefined|none|n\/?a)$/i.test(value.trim())) return '';
  return value.trim().toUpperCase();
}
function decimal(value: string): number | null {
  let raw = value.replace(/\s/g,'');
  if (raw.includes(',') && raw.includes('.')) {
    const decimalSeparator = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? ',' : '.';
    raw = raw.replace(decimalSeparator === ',' ? /\./g : /,/g, '').replace(',', '.');
  } else if (/[,\.]\d{3}$/.test(raw)) return null; // ambiguous grouping, not a cent amount
  else raw = raw.replace(',', '.');
  const n = Number(raw); return Number.isFinite(n) ? n : null;
}
export function printedInvoiceAmount(pdf: string, kind: 'base' | 'total', currency: string | null | undefined): number | null {
  const label = kind === 'base' ? /^(?:base\s+imponible(?:\s*\(sin IVA\))?|sub\s*total|untaxed\s*amount)\s*:?\s*/i
    : /^(?:importe\s+total|total\s+factura|total\s+a\s+pagar|grand\s+total|total\s+due|total)(?!\s*(?:tax|IVA|VAT|amount\s+in\s+words))\s*:?\s*/i;
  const rows = pdf.split(/\r?\n/).map(x=>x.trim());
  const results: number[] = [];
  const symbols: Record<string,string> = {EUR:'€',USD:'$',GBP:'£'};
  for (let i=0;i<rows.length;i++) {
    const match = rows[i].match(label); if (!match) continue;
    const tail = rows[i].slice(match[0].length).trim() || rows[i+1] || '';
    const amount = tail.match(/^(EUR|USD|GBP|€|\$|£)?\s*(-?\d[\d.,]*(?: \d{3})*(?:[.,]\d{2})?)\s*(EUR|USD|GBP|€|\$|£)?\s*$/i);
    if (!amount) continue;
    const tokens = [amount[1], amount[3]].filter(Boolean);
    if (tokens.some(t=>t.toUpperCase() !== currency?.toUpperCase() && t !== symbols[currency?.toUpperCase() || 'EUR'])) continue;
    const value = decimal(amount[2]); if (value != null) results.push(value);
  }
  return results.length && new Set(results).size === 1 ? results[0] : null;
}
