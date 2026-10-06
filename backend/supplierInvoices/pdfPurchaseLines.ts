import type { PdfExtractedLine, PurchaseOrderRecord } from "./phase2Types.ts";

export type SupplierProductAlias = { productId: number; reference?: string | null; barcode?: string | null; name?: string | null };

const normalizeCode = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
const normalizeName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/** A PDF field may contain an EAN and supplier SKU together, e.g. "843... [200205058]". */
export function productReferenceTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  const tokens = new Set<string>();
  const whole = normalizeCode(value);
  if (whole) tokens.add(whole);
  for (const found of value.matchAll(/[A-Z0-9][A-Z0-9._/-]{1,}/gi)) {
    const token = normalizeCode(found[0]);
    if (token.length >= 2 && /\d/.test(token)) tokens.add(token);
  }
  return [...tokens];
}

export function preserveOperatorProductSelections(pdfLines: PdfExtractedLine[], currentLines: PdfExtractedLine[]): PdfExtractedLine[] {
  return pdfLines.map((pdf, index) => {
    const current = currentLines[index];
    if (!current?.productId) return { ...pdf };
    const sameReference = productReferenceTokens(pdf.reference).some((token) => productReferenceTokens(current.reference).includes(token));
    const sameName = normalizeName(pdf.description) === normalizeName(current.description);
    const sameQuantity = pdf.quantity == null || current.quantity == null || Math.abs(pdf.quantity - current.quantity) < 0.0001;
    if (!(sameReference || sameName) || !sameQuantity) return { ...pdf };
    return { ...pdf, productId: current.productId };
  });
}

/** The PDF defines billed values; Odoo supplies product/order identity and separate purchase-status evidence. */
export function cotejarPdfConPedidos(pdfLines: PdfExtractedLine[], orders: PurchaseOrderRecord[], aliases: SupplierProductAlias[] = []): PdfExtractedLine[] {
  const candidates = orders.flatMap((order) => order.lines.filter((line) => line.productId && line.productName).map((line) => ({ order, line })));
  const used = new Set<string>();
  const aliasCodes = (productId: number) => aliases.filter((alias) => alias.productId === productId)
    .flatMap((alias) => [...productReferenceTokens(alias.reference), ...productReferenceTokens(alias.barcode)]);
  const words = (value: string) => new Set(normalizeName(value).split(" ").filter((word) => word.length > 2));
  return pdfLines.filter((pdf) => pdf.priceUnit != null || pdf.total != null).map((pdf) => {
    const refs = productReferenceTokens(pdf.reference);
    const descriptionWords = words(pdf.description);
    const ranked = candidates.map(({ order, line }) => {
      const key = `${order.id}:${line.id ?? `${line.productId}:${line.productName}`}`;
      const alias = aliases.filter((item) => item.productId === line.productId);
      const knownCodes = aliasCodes(line.productId!);
      const referenceHit = refs.some((ref) => knownCodes.includes(ref));
      const supplierNameHit = alias.some((item) => item.name && normalizeName(item.name) === normalizeName(pdf.description));
      const odooNameHit = normalizeName(line.productName ?? "") === normalizeName(pdf.description);
      const targetWords = words([line.productName ?? "", ...alias.map((item) => item.name ?? "")].join(" "));
      const overlap = [...descriptionWords].filter((word) => targetWords.has(word)).length;
      const ratio = descriptionWords.size ? overlap / descriptionWords.size : 0;
      const humanProductHit = Number.isInteger(pdf.productId) && pdf.productId === line.productId;
      const exact = humanProductHit || referenceHit || supplierNameHit || odooNameHit;
      const evidence = [humanProductHit ? "human_product_selection" : "", referenceHit ? "supplier_code_or_ean_exact" : "", supplierNameHit ? "supplier_name_exact" : "", odooNameHit ? "odoo_name_exact" : "", !exact && ratio >= 0.6 ? "normalized_name_overlap" : ""].filter(Boolean);
      const score = humanProductHit ? 100 : referenceHit ? 95 : supplierNameHit ? 85 : odooNameHit ? 80 : Math.round(ratio * 65);
      const probable = !exact && ratio >= 0.6;
      const discrepancies = [pdf.quantity != null && Math.abs(pdf.quantity - line.qtyPending) > 0.0001 ? "quantity" : "", pdf.priceUnit != null && Math.abs(pdf.priceUnit - line.priceUnit) > 0.011 ? "price" : "", pdf.discount != null && Math.abs(pdf.discount - line.discount) > 0.0001 ? "discount" : "", (line.qtyReceived - line.qtyInvoiced) + 0.0001 < (pdf.quantity ?? 0) ? "receipt" : "", line.qtyInvoiced > 0 ? "already_invoiced" : ""].filter(Boolean);
      return { key, order, line, exact, probable, score, evidence, discrepancies };
    }).filter((candidate) => !used.has(candidate.key) && (candidate.exact || candidate.probable)).sort((a, b) => b.score - a.score);
    const exact = ranked.filter((candidate) => candidate.exact);
    let identity = exact;
    // Quantity can separate duplicate lines only for the same already-identified product.
    if (identity.length > 1 && new Set(identity.map((candidate) => candidate.line.productId)).size === 1 && pdf.quantity != null) {
      const byQuantity = identity.filter((candidate) => Math.abs(candidate.line.qtyPending - pdf.quantity!) < 0.0001);
      if (byQuantity.length === 1) identity = byQuantity;
    }
    const unique = identity.length === 1 ? identity[0] : null;
    const proposed = (unique ? [unique] : ranked).slice(0, 5).map((candidate) => ({
      purchaseOrderId: candidate.order.id, purchaseOrderName: candidate.order.name, purchaseLineId: candidate.line.id ?? null,
      productId: candidate.line.productId!, productName: candidate.line.productName!, score: candidate.score,
      identityLevel: (candidate.exact ? (identity.length > 1 ? "ambiguous" : "exact") : "probable") as "exact" | "probable" | "ambiguous",
      evidence: candidate.evidence, discrepancies: candidate.discrepancies,
    }));
    if (!unique) return { ...pdf, productId: pdf.productId ?? null, sourcePurchaseOrderId: null, sourcePurchaseOrderName: null, pdfPriceVerified: false, matchCandidates: proposed };
    used.add(unique.key);
    const { order, line } = unique;
    return { ...pdf, productId: line.productId, sourcePurchaseOrderId: order.id, sourcePurchaseOrderName: order.name,
      qtyOrdered: line.qtyOrdered, qtyReceived: line.qtyReceived, qtyInvoiced: line.qtyInvoiced, qtyPending: line.qtyPending,
      odooPurchasePriceUnit: line.priceUnit, odooPurchaseDiscount: line.discount ?? 0,
      taxId: line.taxIds?.[0] ?? pdf.taxId ?? null,
      // Price equality is evidence only; identity never marks the supplier price verified.
      pdfPriceVerified: false,
      matchCandidates: proposed };
  });
}
