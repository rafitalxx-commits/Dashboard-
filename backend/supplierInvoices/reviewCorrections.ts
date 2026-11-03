import { createHash } from 'node:crypto';
import type { InboxDocument } from './phase2Types.ts';
import { normalizeInvoiceVat, parseInvoiceDate, validInvoiceDate } from '../../shared/supplierInvoiceEvidence.ts';

export function vatAbsenceConfirmed(doc: InboxDocument): boolean {
  const a = doc.issuerVatAbsence;
  return Boolean(a && !normalizeInvoiceVat(doc.extracted?.supplierVat) && a.partnerId === doc.confirmedOdooPartnerId
    && a.supplier === doc.extracted?.supplier && a.country === doc.extracted?.country && a.reason.trim() && a.by && a.at);
}
export function reviewFingerprint(doc: InboxDocument, pdfDigest: string): string {
  return createHash('sha256').update(JSON.stringify({ id: doc.driveFileId, pdfDigest, modified: doc.modifiedTime,
    extracted: doc.extracted, supplier: doc.confirmedOdooPartnerId, vatAbsence: doc.issuerVatAbsence,
    branch: doc.invoiceBranch, accepted: doc.pdfLinesAccepted, orders: doc.assignedPurchaseOrderIds,
    status: doc.status, moveId: doc.odooDraftMoveId, present: doc.sourcePresent, movedTo: doc.movedTo })).digest('hex');
}
export function exceptionRequestError(doc: InboxDocument, input: unknown, fingerprint: string, blockers: string[]): string | null {
  const value = input as { acknowledged?: boolean; reason?: string; fingerprint?: string; blockers?: string[] } | null;
  if (!value || value.acknowledged !== true || typeof value.reason !== 'string' || value.reason.trim().length < 10)
    return 'Confirma expresamente el envío con pendientes e indica el motivo (mínimo 10 caracteres).';
  if (value.fingerprint !== fingerprint || JSON.stringify(value.blockers) !== JSON.stringify(blockers))
    return 'La factura, el PDF o sus pendientes cambiaron. Vuelve a revisar antes de confirmar.';
  if (!doc.extracted || !doc.confirmedOdooPartnerId || !['goods','services'].includes(doc.invoiceBranch || '')
    || doc.sourcePresent === false || doc.movedTo || doc.odooDraftMoveId) return 'Confirma proveedor y tipo de factura, y conserva el PDF pendiente sin otro borrador.';
  if (!doc.extracted.invoiceNumber || !validInvoiceDate(doc.extracted.invoiceDate || '') || !doc.extracted.lines.length)
    return 'Completa referencia, fecha válida y al menos una línea antes de enviar a Odoo.';
  if (doc.invoiceBranch === 'services' && !doc.pdfLinesAccepted) return 'Acepta explícitamente las líneas de servicio sin pedido.';
  if (blockers.some(x=>/No se pudo|no disponible|no configurado|Ya existe una factura|Ya hay un borrador|ya no est|inactivo|identidad Odoo.*no coinciden/i.test(x)))
    return 'Hay un fallo de acceso, duplicado o identidad que requiere resolver antes del envío.';
  return null;
}
/** Build an atomic local patch; never writes Odoo or learns fiscal exemptions. */
export function correctedReview(doc: InboxDocument, body: Record<string, any>, by: string): InboxDocument {
  if (!doc.extracted || doc.odooDraftMoveId) throw new Error('No se puede corregir este borrador local.');
  const next = structuredClone(doc), ex = next.extracted!;
  const fields = body.fields ?? {};
  const keys = ['supplierVat','invoiceNumber','invoiceDate','dueDate','base','taxes','total','currency'];
  for (const key of Object.keys(fields)) {
    if (!keys.includes(key)) throw new Error('Campo de corrección no permitido.');
    const value = fields[key];
    if (['base','taxes','total'].includes(key)) {
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Importe no válido.');
      (ex as any)[key] = value == null ? null : Math.round(value * 100) / 100;
    } else if (key === 'invoiceDate' || key === 'dueDate') {
      const date = value ? parseInvoiceDate(String(value)) : null;
      if (value && !date) throw new Error('Fecha no válida.');
      ex[key] = date;
    } else if (key === 'supplierVat') ex.supplierVat = normalizeInvoiceVat(value) || null;
    else {
      if (typeof value !== 'string') throw new Error('Texto no válido.');
      (ex as any)[key] = value.trim().slice(0,60) || null;
      if (key === 'currency' && ex.currency && !/^[A-Z]{3}$/.test(ex.currency)) throw new Error('Moneda ISO no válida.');
    }
  }
  if (body.lineCorrections !== undefined) {
    if (!Array.isArray(body.lineCorrections) || body.lineCorrections.length !== ex.lines.length) throw new Error('Las líneas cambiaron: vuelve a abrir la corrección.');
    for (let i=0;i<ex.lines.length;i++) {
      const patch = body.lineCorrections[i];
      for (const k of Object.keys(patch)) {
        if (!['taxId','accountId','taxAmount'].includes(k)) throw new Error('Campo de línea no permitido.');
        const v = patch[k];
        if (v != null && (typeof v !== 'number' || !Number.isFinite(v) || (k !== 'taxAmount' && (!Number.isInteger(v) || v <= 0)))) throw new Error('Identificador o cuota no válidos.');
        (ex.lines[i] as any)[k] = v;
      }
    }
    next.operatorLinesEdited = true;
  }
  if (body.vatAbsent === true) {
    if (normalizeInvoiceVat(ex.supplierVat) || !next.confirmedOdooPartnerId || typeof body.reason !== 'string' || body.reason.trim().length < 10)
      throw new Error('Para confirmar la ausencia de NIF, deja el NIF vacío, selecciona proveedor e indica el motivo.');
    ex.supplierVat = null;
    next.issuerVatAbsence = { partnerId: next.confirmedOdooPartnerId, supplier: ex.supplier, country: ex.country,
      reason: body.reason.trim().slice(0,1000), by, at: new Date().toISOString() };
  } else if (body.vatAbsent === false || normalizeInvoiceVat(ex.supplierVat)) next.issuerVatAbsence = null;
  next.operatorEditedFields = [...new Set([...(next.operatorEditedFields || []), ...Object.keys(fields)])];
  next.reviewChat = [...(next.reviewChat || []), { at: new Date().toISOString(), role: 'system', content: `Corrección guiada guardada por ${by}. ${body.vatAbsent ? 'Ausencia de NIF declarada por el operario; no es una exención fiscal automática.' : ''}` }];
  if (next.status === 'VALIDADA') { next.status = 'PENDIENTE_COTEJO'; next.validationAt = null; next.validationUser = null; }
  return next;
}
