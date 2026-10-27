import { normalizeSupplierName } from "./documentInbox.ts";

const normalizeVat = (value: string | null | undefined) => String(value ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
const stripCountryPrefix = (value: string) => /^[A-Z]{2}/.test(value) ? value.slice(2) : value;

/** Match a labeled supplier VAT near its Odoo legal name, allowing dotted suffixes such as `S.L.`. */
export function pdfIssuerVatMatches(pdfText: string, partnerName: string, partnerVat: string | null): boolean {
  const targetVat = normalizeVat(partnerVat);
  const words = normalizeSupplierName(partnerName).split(/\s+/).filter(Boolean);
  if (!targetVat || words.length < 2) return false;
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokenPattern = (word: string) => word.length <= 4
    ? word.split("").map(escape).join("[^A-Z0-9]{0,2}")
    : escape(word);
  const namePattern = new RegExp(words.map(tokenPattern).join("[^A-Z0-9]{0,12}"), "i");
  const nameMatch = namePattern.exec(pdfText);
  if (!nameMatch) return false;

  const start = Math.max(0, nameMatch.index - 120);
  const end = Math.min(pdfText.length, nameMatch.index + nameMatch[0].length + 180);
  const nearby = pdfText.slice(start, end);
  const beforeName = pdfText.slice(Math.max(0, nameMatch.index - 100), nameMatch.index);
  const supplierRole = [...beforeName.matchAll(/\b(?:emisor|proveedor|supplier)\b/gi)].at(-1)?.index ?? -1;
  const customerRole = [...beforeName.matchAll(/\b(?:cliente|comprador|customer|buyer)\b/gi)].at(-1)?.index ?? -1;
  if (customerRole > supplierRole) return false;
  for (const label of nearby.matchAll(/\b(?:NIF|CIF|VAT|identif(?:icaci[oó]n)?\.?\s*fiscal)\b/gi)) {
    const valueWindow = nearby.slice(label.index! + label[0].length, label.index! + label[0].length + 90);
    for (const raw of valueWindow.matchAll(/(?:ES)?[A-Z]\s*[- ]?\s*\d(?:[\s-]?\d){7}\b/gi)) {
      const found = normalizeVat(raw[0]);
      if (found === targetVat || stripCountryPrefix(found) === stripCountryPrefix(targetVat)) return true;
    }
  }
  return false;
}
