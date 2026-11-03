export type BatchDocument = {
  driveFileId: string; modifiedTime: string | null; size?: number | null;
  sourcePresent?: boolean; movedTo?: string | null; status: string; odooDraftMoveId?: number | null;
};
export type Checkpoint = {
  version: 1; target: string;
  documents: Record<string, { fingerprint: string; at: string; outcome: "prepared" | "pending" | "error"; blockers: string[] }>;
};
type Api = (path: string, method: "GET" | "POST", body?: unknown) => Promise<any>;
const root = "/api/odoo/supplier-invoices/inbox";

// Sequential by design: each PDF has its own existing review thread and save.
// This module cannot call validation, accounting, uploads or archive endpoints.
export async function prepareInvoiceBatch(api: Api, checkpoint: Checkpoint, save: () => void) {
  await api(`${root}/scan`, "POST", {});
  const manifest = await api(root, "GET");
  if (!Array.isArray(manifest.items)) throw new Error("Respuesta de bandeja inválida");
  const summary = { present: manifest.items.length, prepared: 0, pending: 0, failed: 0, skipped: 0 };
  for (const doc of manifest.items as BatchDocument[]) {
    if (!/^[A-Za-z0-9_-]+$/.test(doc.driveFileId)) throw new Error("ID de Drive inválido");
    if (doc.sourcePresent !== true || doc.movedTo || doc.status === "VALIDADA" || doc.odooDraftMoveId) {
      summary.skipped++; continue;
    }
    const fingerprint = JSON.stringify([doc.modifiedTime, doc.size ?? null]);
    const previous = checkpoint.documents[doc.driveFileId];
    // Partial proposals wait for the reviewer, not an endless expensive AI retry.
    if (doc.modifiedTime && previous?.fingerprint === fingerprint && previous.outcome !== "error") {
      summary.skipped++; continue;
    }
    let entry: Checkpoint["documents"][string];
    try {
      const result = await api(`${root}/raskibot-extract`, "POST", { ids: [doc.driveFileId] });
      if (result.status !== "ok" || result.document?.driveFileId !== doc.driveFileId || !result.scanOutcome)
        throw new Error("La respuesta no acredita el guardado de esta factura");
      const blockers: string[] = [...new Set<string>([
        ...(result.scanOutcome.unresolved ?? []), ...(result.verification?.blockers ?? []),
        ...(!result.verification ? ["Falta el cotejo independiente con Odoo"] : []),
      ])];
      const ready = result.scanOutcome.status === "complete" && result.verification?.ready === true && !blockers.length;
      entry = { fingerprint, at: new Date().toISOString(), outcome: ready ? "prepared" : "pending", blockers };
      if (ready) summary.prepared++; else summary.pending++;
    } catch (error) {
      // Invalid machine credentials are a batch failure, never 17 document failures.
      if ([401, 403].includes(Number((error as any)?.status))) throw error;
      entry = { fingerprint, at: new Date().toISOString(), outcome: "error", blockers: [error instanceof Error ? error.message : "Error de análisis"] };
      summary.failed++;
    }
    checkpoint.documents[doc.driveFileId] = entry;
    save(); // Outside the per-PDF catch: a checkpoint failure must stop the run.
  }
  return summary;
}
