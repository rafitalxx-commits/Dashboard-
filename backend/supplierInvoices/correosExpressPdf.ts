// Exact Ecosystems B2B text layout only. Never extrapolate to other suppliers.
const money = (value: string) => /^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(value)
  ? Number(value.replaceAll(".", "").replace(",", ".")) : NaN;
const round = (value: number) => Math.round(value * 100) / 100;
export function extractCorreosExpressPdf(text: string) {
  if (!/Proveedor\s*-\s*emisor\s+ESA28799120\s+CORREOS EXPRESS/.test(text)) return null;
  const number = text.match(/Factura(F\d+)\b/)?.[1];
  if (new Set([...text.matchAll(/Factura(F\d+)\b/g)].map((match) => match[1])).size !== 1) return null;
  const amount = (label: string) => {
    const value = text.match(new RegExp(`${label}:\\s*(-?[\\d.]+,\\d{2})`))?.[1];
    return value === undefined ? null : money(value);
  };
  const base = amount("Bruto antes de impuesto"), taxes = amount("Impuestos repercutidos"), total = amount("Total factura");
  const rows = [...text.matchAll(/(-?[\d.]+,\d{2})(-?[\d.]+,\d{2})\s+UnidadesIVA\s+(\d+)%(-?[\d.]+,\d{2})/g)];
  if (!number || base == null || taxes == null || total == null || !rows.length) return null;
  if (![base, taxes, total].every(Number.isFinite)) return null;
  // One billed shipment per printed Albarán, including zero-value rows.
  if (rows.length !== [...text.matchAll(/Albarán:/g)].length) return null;
  const lines: { description: string; reference: string; quantity: number | null; priceUnit: number | null; discount: number; taxNames: string[]; total: number }[] = [];
  let start = 0;
  for (const row of rows) {
    const block = text.slice(start, row.index);
    const reference = block.match(/Albarán:\s*(\d+)/)?.[1];
    const concepts = [...block.matchAll(/(?:^|\n)(\d{1,3}-[^\n]+(?:\n(?!Expte\.:)[^\n]+)*)\n\s*Expte\.:/g)];
    const description = concepts.at(-1)?.[1].replace(/\s+/g, " ").trim();
    const fuelValues = [...block.matchAll(/Suplemento fuel:\s*(-?[\d.]+,\d{2})/g)];
    if (!reference || !description || fuelValues.length > 1) return null;
    const unit = money(row[1]), quantity = money(row[2]), rowTotal = money(row[4]);
    const fuel = fuelValues.length ? money(fuelValues[0][1]) : 0;
    if (![unit, quantity, rowTotal, fuel].every(Number.isFinite)) return null;
    const lineBase = round(unit * quantity);
    if (Math.abs(round(lineBase + fuel) - rowTotal) > 0.005) return null;
    const taxNames = [`IVA ${row[3]}%`];
    lines.push({ description: `${description} · Albarán ${reference}`, reference, quantity, priceUnit: unit, discount: 0, taxNames, total: lineBase });
    if (fuelValues.length) lines.push({ description: `Suplemento fuel · Albarán ${reference}`, reference, quantity: null, priceUnit: null, discount: 0, taxNames, total: fuel });
    start = row.index! + row[0].length;
  }
  if (lines.length > 5000 || Math.abs(round(lines.reduce((sum, line) => sum + line.total, 0)) - base) > 0.005 || Math.abs(round(base + taxes) - total) > 0.005) return null;
  const date = (value?: string) => value ? value.split("/").reverse().join("-") : null;
  const invoiceDate = date(text.match(/Fecha emisión:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1]);
  const dueDate = date(text.slice(text.lastIndexOf("Datos de vencimiento")).match(/\d{2}\/\d{2}\/\d{4}/)?.[0]);
  if (!invoiceDate || !/Divisa:\s*Euro\s*\(EUR\)/.test(text)) return null;
  return { fields: { supplier: "CORREOS EXPRESS PAQUETERIA URGENTE, S.A., S.M.E", supplierVat: "ESA28799120", invoiceNumber: number, invoiceDate, dueDate, currency: "EUR", base, taxes, total }, lines, shipmentCount: rows.length };
}
