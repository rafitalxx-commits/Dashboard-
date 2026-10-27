type PdfLine = { description: string; productId?: number | null; sourcePurchaseLineId?: number | null; quantity: number | null; priceUnit: number | null; total: number | null; taxAmount?: number | null };
type OdooLine = { description: string; productId: number | null; purchaseLineId: number | null; quantity: number; priceUnit: number; base: number; total: number };
type PdfInvoice = { invoiceNumber?: string | null; dueDate?: string | null; base: number | null; taxes: number | null; total: number | null; lines: PdfLine[] };
type OdooDraft = { reference: string; dueDate: string | null; base: number; taxes: number; total: number; lines: OdooLine[] };

const cents = (value: number) => Math.round(value * 100);

/** No se archiva un PDF sólo porque Odoo devolvió HTTP 200: coteja el borrador releído. */
export function archiveMismatch(pdf: PdfInvoice | null | undefined, draft: OdooDraft | null | undefined, warnings: string[] = [], branch: "goods" | "services" = "goods"): string | null {
  if (!pdf || !draft) return "Falta el PDF o la relectura del borrador Odoo.";
  if (warnings.length) return "Odoo devolvió avisos que requieren revisión.";
  if (!pdf.invoiceNumber || draft.reference.trim() !== pdf.invoiceNumber.trim()) return "La referencia Odoo no coincide con el PDF.";
  if (pdf.dueDate && draft.dueDate !== pdf.dueDate) return "El vencimiento Odoo no coincide con el PDF.";
  if (pdf.base == null || pdf.taxes == null || pdf.total == null ||
      cents(draft.base) !== cents(pdf.base) || cents(draft.taxes) !== cents(pdf.taxes) || cents(draft.total) !== cents(pdf.total))
    return "Los importes Odoo no coinciden con el PDF.";
  // En servicios sin pedido, el operario puede agrupar conceptos o usar líneas
  // contables sin producto. El borrador releído debe cuadrar, pero no replicar
  // literalmente el desglose del PDF.
  if (branch === "services") return draft.lines.length ? null : "El borrador Odoo no contiene líneas de servicio.";
  if (draft.lines.length !== pdf.lines.length) return "El número de líneas Odoo no coincide con el PDF.";
  const remaining = [...draft.lines];
  for (let i = 0; i < pdf.lines.length; i++) {
    const line = pdf.lines[i];
    if (line.productId == null || line.quantity == null || line.priceUnit == null || line.total == null || line.taxAmount == null)
      return `La línea ${i + 1} del PDF no está completamente cotejada.`;
    const match = remaining.findIndex((row) => row.description.trim() === line.description.trim() && row.productId === line.productId &&
      (row.purchaseLineId ?? null) === (line.sourcePurchaseLineId ?? null) &&
      Math.abs(row.quantity - line.quantity!) < 0.0001 && Math.abs(row.priceUnit - line.priceUnit!) < 0.001 &&
      cents(row.base) === cents(line.total!) && cents(row.total) === cents(line.total! + line.taxAmount!));
    if (match < 0) return `La línea ${i + 1} de Odoo no coincide en descripción, producto, pedido, cantidad, precio o importe.`;
    remaining.splice(match, 1);
  }
  return null;
}
