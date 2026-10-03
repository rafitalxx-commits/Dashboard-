// Rutas Fase 2: bandeja documental (Drive + extraccion + cotejo) y pedidos sin facturar.
// SOLO LECTURA de Drive/Odoo. Escritura unicamente del registro documental local del LAB.
// OJO: este middleware es first-match-wins por prefijo. Las sub-rutas especificas
// (/inbox/detail, /inbox/scan, /unbilled/sync...) DEBEN registrarse ANTES que sus listas.

import { createReadStream, existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { SupplierInvoiceSyncService } from "./service.ts";
import { DocumentInboxService, matchDocument, buildPoIndex, parseDate, normalizeSupplierName } from "./documentInbox.ts";
import { SupplierMappingStore } from "./supplierMappings.ts";
import { odooSession, odooWriteEnabled, createSupplierDraft, postSupplierInvoice, discardSupplierDraft } from "./odooBridge.ts";
import type { DraftResult } from "./odooBridge.ts";
import { aiExtractCachedPdf, mergeExtracted } from "./aiExtract.ts";
import { PurchaseOrdersLedger, computeBilling, filterOrders, computeUnbilledKpis } from "./unbilled.ts";
import { DriveClient } from "./driveClient.ts";
import { searchRead } from "./odooClient.ts";

type MiddlewareServer = {
  middlewares: {
    use: (path: string, handler: (request: any, response: any) => void) => void;
  };
};

type AuthReader = {
  getSessionUser: (cookie?: string) =>
    | { id: string; name: string; role: string; permissions: string[] }
    | undefined;
};

type Deps = {
  env: Record<string, string | undefined>;
  dataDir: string;
};

const PERMISSIONS = ["supplierBilling", "purchases", "billing"];

function hasPermission(user: { permissions: string[] } | undefined): boolean {
  return Boolean(user && user.permissions.some((p) => PERMISSIONS.includes(p)));
}

// Fase 2.4: nombre de carpeta seguro para Drive (sin barras ni caracteres problematicos).
function sanitizeFolderName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
}

function sendJson(response: any, status: number, body: unknown): void {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

export function registerSupplierInvoicesPhase2Routes(server: MiddlewareServer, auth: AuthReader, deps: Deps) {
  const invoiceService = new SupplierInvoiceSyncService({ dataDir: deps.dataDir });
  const inboxService = new DocumentInboxService({ dataDir: deps.dataDir });
  const poLedger = new PurchaseOrdersLedger({ dataDir: deps.dataDir });
  // Memoria de mapeos de proveedor: correcciones humanas que se reutilizan en futuras extracciones.
  const mappingStore = new SupplierMappingStore({ dataDir: deps.dataDir });

  const requireUser = (request: any, response: any) => {
    const user = auth.getSessionUser(request.headers.cookie);
    if (!user) {
      sendJson(response, 401, { message: "Login requerido" });
      return null;
    }
    if (!hasPermission(user)) {
      sendJson(response, 403, { message: "Permiso insuficiente" });
      return null;
    }
    return user;
  };

  // Catálogos fiscales: lectura exclusiva. Las elecciones se guardan solamente
  // en el documento local hasta una futura acción autorizada de borrador Odoo.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/fiscal-options", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    try {
      const session = await odooSession(deps.env);
      const [taxRows, accountRows] = await Promise.all([
        searchRead(session.config, session.uid, "account.tax", [["active", "=", true], ["type_tax_use", "=", "purchase"]], ["id", "name", "amount"], { order: "name asc", limit: 300 }),
        searchRead(session.config, session.uid, "account.account", [["deprecated", "=", false]], ["id", "code", "name"], { order: "code asc", limit: 500 }),
      ]);
      sendJson(response, 200, {
        taxes: taxRows.map((r) => ({ id: Number(r.id), name: String(r.name ?? "Impuesto"), rate: Number(r.amount ?? 0) })),
        accounts: accountRows.map((r) => ({ id: Number(r.id), name: `${String(r.code ?? "")} · ${String(r.name ?? "")}`.replace(/^\s*·\s*/, "") })),
      });
    } catch (e) {
      sendJson(response, 502, { message: e instanceof Error ? e.message : "No se pudieron leer impuestos y cuentas de Odoo" });
    }
  });

  const enrichedOrders = () =>
    computeBilling(poLedger.getStore().orders, invoiceService.getStore().invoices.map((i) => ({
      id: i.id, moveType: i.moveType, state: i.state, amountTotal: i.amountTotal, linkedPurchaseOrderIds: i.linkedPurchaseOrderIds,
    })));

  // ---------- Bandeja documental: sub-rutas (ANTES de la lista) ----------

  // Detalle de un documento de la bandeja (por driveFileId).
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/detail", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const id = new URL(request.url ?? "/", "http://local").searchParams.get("id") ?? "";
    const doc = inboxService.getDocument(id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado en la bandeja" });
    sendJson(response, 200, doc);
  });

  // PDF cacheado en el LAB para previsualizacion (no re-descarga si ya existe).
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/file", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const id = new URL(request.url ?? "/", "http://local").searchParams.get("id") ?? "";
    const doc = inboxService.getDocument(id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    const path = `${deps.dataDir.replace(/\/$/, "")}/supplier-invoices/inbox/${id}.pdf`;
    if (!existsSync(path)) return sendJson(response, 404, { message: "PDF no cacheado; ejecuta un escaneo primero" });
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `inline; filename="${basename(doc.name).replace(/[\r\n"]/g, "_")}"`);
    createReadStream(path).pipe(response);
  });

  // Visor PDF: streaming DIRECTO desde Drive (sin cachear en disco del VPS).
  // Passthrough de solo lectura; nunca escribe ni renombra nada en Drive.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/preview", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const id = new URL(request.url ?? "/", "http://local").searchParams.get("id") ?? "";
    const doc = inboxService.getDocument(id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    const client = new DriveClient(deps.env);
    const err = client.configError();
    if (err) return sendJson(response, 500, { message: err });
    if (response.writableEnded) return;
    response.setHeader("Content-Disposition", `inline; filename="${basename(doc.name).replace(/[\r\n"]/g, "_")}"`);
    try {
      await client.streamPdf(id, response);
    } catch (error) {
      if (response.writableEnded) return;
      sendJson(response, 502, { message: error instanceof Error ? error.message : "Error streameando PDF desde Drive" });
    }
  });

  // Escaneo Drive -> descarga -> extraccion -> cotejo -> store local. NUNCA escribe en Drive/Odoo.
  // Watcher: los documentos recien detectados reciben el primer mapeo IA automaticamente
  // (batch de hasta 3), dejandolos en PENDIENTE_VALIDAR para que Rafa solo confirme.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/scan", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    try {
      const result = await inboxService.scan(
        deps.env,
        invoiceService.getStore().invoices,
        buildPoIndex(poLedger.getStore()),
        user.name,
      );
      let autoExtract: Awaited<ReturnType<typeof runAiExtraction>> | null = null;
      // Reclasificacion con fuerza: re-evalua TODOS los documentos con la heuristica
      // actual (patrones de tipo de documento) y des-excluye lo que ya no es no-factura.
      await inboxService.reclassifyDocuments(true);
      if (result.addedIds.length) {
        autoExtract = await runAiExtraction(user, result.addedIds.map((d) => d.driveFileId));
      }
      sendJson(response, 200, {
        status: "ok",
        ...result,
        autoExtract,
        lastScanAt: inboxService.getStore().meta.lastScanAt,
      });
    } catch (error) {
      sendJson(response, 500, {
        status: "error",
        message: error instanceof Error ? error.message : "Error escaneando Drive",
      });
    }
  });

  // Estado documental local (validacion humana). No toca Drive ni Odoo.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/status", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string; driveFileId?: string; status?: string; notes?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    const documentId = body.id ?? body.driveFileId;
    if (!documentId || !body.status) return sendJson(response, 400, { message: "Faltan id o status" });
    const allowed = ["SIN_REVISAR", "EN_REVISION", "PENDIENTE_COTEJO", "PENDIENTE_VALIDAR", "VALIDADA", "INCIDENCIA"];
    if (!allowed.includes(body.status)) return sendJson(response, 400, { message: "Estado no permitido" });
    const existingDoc = inboxService.getDocument(documentId);
    if (!existingDoc) return sendJson(response, 404, { message: "Documento no encontrado" });
    // Una factura de mercancía puede revisarse antes de recibirla, pero no se
    // cierra/contabiliza hasta que Odoo confirme la recepción. Servicios sin
    // líneas de pedido no entran en esta protección.
    if (body.status === "VALIDADA" && (existingDoc.assignedPurchaseOrderIds?.length ?? 0) > 0) {
      const selected = poLedger.getStore().orders.filter((o) => existingDoc.assignedPurchaseOrderIds!.includes(o.id));
      const pendingReception = selected.some((o) => o.lines.some((l) => l.qtyOrdered > 0 && l.qtyReceived + 1e-6 < l.qtyOrdered));
      if (pendingReception) {
        return sendJson(response, 409, { message: "Factura revisada, pendiente de recepción en Odoo. Actualiza las recepciones cuando llegue la mercancía antes de validar." });
      }
    }
    const doc = inboxService.setStatus(documentId, body.status as any, user.name, body.notes)!;
    // Validar sólo certifica el cotejo humano. Crear un borrador es una acción
    // separada, visible y explícita en su propio botón / ruta autorizada.
    sendJson(response, 200, { status: "ok", document: doc, odooDraft: null });
  });

  // Recotejo manual de un documento contra el cache actual.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/rematch", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!body.id) return sendJson(response, 400, { message: "Falta id" });
    const doc = inboxService.getDocument(body.id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    const match = matchDocument(doc, invoiceService.getStore().invoices, buildPoIndex(poLedger.getStore()));
    const target = inboxService.getStore().documents.find((d) => d.driveFileId === body.id);
    if (target) target.match = match;
    // Recalcular no deshace una decisión final humana ni una incidencia.
    // Para estados abiertos actualiza el estado de trabajo junto al resultado.
    const refreshed = inboxService.getDocument(body.id)!;
    if (refreshed.status !== "VALIDADA" && refreshed.status !== "INCIDENCIA") {
      inboxService.setStatus(body.id, match && match.band === "alta" ? "PENDIENTE_VALIDAR" : "PENDIENTE_COTEJO", user.name);
    }
    sendJson(response, 200, { status: "ok", match, document: inboxService.getDocument(body.id) });
  });

  // Edicion local de lineas extraidas (editor de productos, 2.4). Solo persiste el
  // registro documental del LAB; nunca toca Odoo ni Drive.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/lines", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string; base?: unknown; taxes?: unknown; lines?: { description: string; reference: string | null; quantity: number | null; priceUnit: number | null; discount: number | null; taxNames: string[]; taxId?: number | null; taxAmount?: number | null; accountId?: number | null; accountName?: string | null; total: number | null; sourcePurchaseOrder?: string | null }[] } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!body.id || !Array.isArray(body.lines)) return sendJson(response, 400, { message: "Faltan id o lines" });
    const doc = inboxService.getDocument(body.id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    if (!doc.extracted) return sendJson(response, 400, { message: "El documento no tiene datos extraidos" });
    const clean = body.lines.slice(0, 60).map((l) => ({
      description: String(l.description ?? "").slice(0, 200) || "(concepto)",
      reference: l.reference ? String(l.reference).slice(0, 60) : null,
      quantity: typeof l.quantity === "number" && Number.isFinite(l.quantity) ? Math.round(l.quantity * 100) / 100 : null,
      priceUnit: typeof l.priceUnit === "number" && Number.isFinite(l.priceUnit) ? Math.round(l.priceUnit * 100) / 100 : null,
      discount: typeof l.discount === "number" && Number.isFinite(l.discount) ? Math.round(l.discount * 100) / 100 : null,
      taxNames: Array.isArray(l.taxNames) ? l.taxNames.filter((t): t is string => typeof t === "string").slice(0, 4) : [],
      taxId: typeof l.taxId === "number" && Number.isInteger(l.taxId) ? l.taxId : null,
      taxAmount: typeof l.taxAmount === "number" && Number.isFinite(l.taxAmount) ? Math.round(l.taxAmount * 100) / 100 : null,
      accountId: typeof l.accountId === "number" && Number.isInteger(l.accountId) ? l.accountId : null,
      accountName: l.accountName ? String(l.accountName).slice(0, 160) : null,
      total: typeof l.total === "number" && Number.isFinite(l.total) ? Math.round(l.total * 100) / 100 : null,
      sourcePurchaseOrder: l.sourcePurchaseOrder ? String(l.sourcePurchaseOrder).slice(0, 40) : null,
      confidence: 95,
    }));
    doc.extracted.lines = clean;
    const money = (value: unknown) => typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
    if (body.base !== undefined) {
      const base = money(body.base);
      if (Number.isFinite(base)) doc.extracted.base = Math.round(base * 100) / 100;
    }
    if (body.taxes !== undefined) {
      const tax = money(body.taxes);
      if (Number.isFinite(tax)) doc.extracted.taxes = Math.round(tax * 100) / 100;
    }
    doc.notes = [...(doc.notes ? [doc.notes] : []), `Lineas editadas por ${user.name}`].join("; ").slice(0, 400);
    inboxService.save();
    sendJson(response, 200, { status: "ok", lines: doc.extracted.lines, total: doc.extracted.total, document: doc });
  });

  // Edicion de campos extraidos (cabecera) + memoria de mapeos por proveedor:
  // al guardar, las correcciones se aprenden por proveedor y se auto-aplican en la proxima extraccion.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/fields", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string; fields?: Record<string, unknown> } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!body.id || !body.fields || typeof body.fields !== "object") return sendJson(response, 400, { message: "Faltan id o fields" });
    const doc = inboxService.getDocument(body.id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    if (!doc.extracted) return sendJson(response, 400, { message: "El documento no tiene datos extraidos" });
    const f = body.fields;
    const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);
    const money = (v: unknown) => {
      if (v === "" || v === null || v === undefined) return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    };
    const ex = doc.extracted;
    ex.supplier = str(f.supplier) ?? ex.supplier;
    ex.supplierVat = str(f.supplierVat, 20)?.toUpperCase() ?? ex.supplierVat;
    ex.country = str(f.country, 20)?.toUpperCase() ?? ex.country;
    ex.invoiceNumber = str(f.invoiceNumber, 60) ?? ex.invoiceNumber;
    const dInv = str(f.invoiceDate, 10);
    if (dInv) ex.invoiceDate = parseDate(dInv);
    const dDue = str(f.dueDate, 10);
    if (dDue) ex.dueDate = parseDate(dDue);
    ex.currency = str(f.currency, 3)?.toUpperCase() ?? ex.currency;
    ex.billingAddress = str(f.billingAddress) ?? ex.billingAddress;
    // Reclasificacion manual del tipo de documento (p.ej. un albaran mal clasificado que es factura)
    const docTypes = ["factura", "albaran", "aduana", "transporte", "otro"];
    const fType = str(f.docType, 20)?.toLowerCase();
    if (fType && docTypes.includes(fType)) ex.docType = fType as PdfExtractedData["docType"];
    if (f.base !== undefined) ex.base = money(f.base);
    if (f.taxes !== undefined) ex.taxes = money(f.taxes);
    if (f.total !== undefined) ex.total = money(f.total);
    doc.notes = [...(doc.notes ? [doc.notes] : []), `Campos editados por ${user.name}`].join("; ").slice(0, 400);
    // Memoria: aprender el mapeo canonico del proveedor con lo corregido
    const learned = mappingStore.upsert({ supplier: ex.supplier, vat: ex.supplierVat, country: ex.country, billingAddress: ex.billingAddress }, user.name);
    // Recotejo inmediato con los datos corregidos
    const match = matchDocument(doc, invoiceService.getStore().invoices, buildPoIndex(poLedger.getStore()));
    let targetStatus: string | null = null;
    if (match) {
      doc.match = match;
      // Confianza humana (pedidos asociados + total que coincide o banda alta) => pasa a validacion
      const assigned = (doc.assignedPurchaseOrderIds?.length ?? 0) > 0;
      if (!match.excluded && (match.band === "alta" || (assigned && match.band !== "sin"))) targetStatus = "PENDIENTE_VALIDAR";
      else if (!match.excluded) targetStatus = "PENDIENTE_COTEJO";
      else targetStatus = "PENDIENTE_COTEJO";
    }
    if (targetStatus && doc.status !== "VALIDADA" && doc.status !== "INCIDENCIA") doc.status = targetStatus;
    inboxService.save();
    sendJson(response, 200, { status: "ok", document: doc, mapping: { learned: true, supplierName: learned.supplierName, samples: learned.samples } });
  });

  // Registro de mapeos aprendidos por proveedor (solo lectura).
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/mappings", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    sendJson(response, 200, { total: mappingStore.size(), items: mappingStore.list() });
  });

  // Multi-pedido: candidatos de una factura compuesta por varios pedidos de compra.
  // Pedidos sin facturar del mismo proveedor (por VAT o nombre), reciente -> antiguo.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/po-filter", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const url = new URL(request.url ?? "/", "http://local");
    const id = url.searchParams.get("id") ?? "";
    const doc = id ? inboxService.getDocument(id) : null;
    const ex = doc?.extracted;
    if (!ex) return sendJson(response, 400, { message: "Documento sin datos extraidos" });
    const supName = normalizeSupplierName(ex.supplier);
    const normVat = (v: string | null) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const supVat = normVat(ex.supplierVat);
    const assignedIds = new Set(doc?.assignedPurchaseOrderIds ?? []);
    // Referencias explícitas del PDF: 04957 y P04957 son el mismo pedido.
    // Deben verse aunque el proveedor aún esté sin corregir o la IA falle.
    let referenceText = ex.textPreview ?? "";
    const cachedPdf = `${deps.dataDir.replace(/\/$/, "")}/supplier-invoices/inbox/${id}.pdf`;
    // textPreview es deliberadamente corto para la bandeja. Para sugerir pedidos
    // hay que leer el PDF entero: una factura puede mencionar varios pedidos en
    // páginas o bloques posteriores.
    if (existsSync(cachedPdf)) {
      try { referenceText = (await pdfParse(readFileSync(cachedPdf))).text ?? referenceText; } catch { /* se conserva el resumen */ }
    }
    const explicitOrderNames = new Set(
      referenceText.match(/\bP?0\d{4,}\b/gi)?.map((value) =>
        value.toUpperCase().startsWith("P") ? value.toUpperCase() : `P${value}`,
      ) ?? [],
    );
    // Normaliza el prefijo de país del VAT (ESB87629895 == B87629895) para comparar con el ledger.
    const countryStrip = (v: string) => (v.length > 9 && /^[A-Z]{2}/.test(v) ? v.slice(2) : v);
    const orders = poLedger.getStore().orders
      .filter((o) => o.state === "purchase" || o.state === "done")
      .filter((o) => (o.billedPct ?? 0) < 99)
      .filter((o) => {
        if (assignedIds.has(o.id) || explicitOrderNames.has(o.name.toUpperCase())) return true;
        const poVat = normVat(o.partnerVat);
        if (supVat && poVat) {
          return poVat === supVat || countryStrip(poVat) === countryStrip(supVat);
        }
        return !supVat && supName && normalizeSupplierName(o.partnerName) === supName;
      })
      .sort((a, b) => (b.dateOrder ?? "").localeCompare(a.dateOrder ?? "") || b.id - a.id)
      .map((o) => ({
        id: o.id,
        name: o.name,
        origin: o.origin ?? null,
        dateOrder: o.dateOrder,
        amountTotal: o.amountTotal,
        currency: o.currency,
        state: o.state,
        billedAmount: o.billedAmount,
        billedPct: o.billedPct,
        pendingAmount: o.pendingAmount,
        allReceived: o.allReceived,
        lastReceptionAt: o.lastReceptionAt,
        lines: o.lines.map((l) => ({
          productName: l.productName,
          qtyOrdered: l.qtyOrdered,
          qtyReceived: l.qtyReceived,
          qtyInvoiced: l.qtyInvoiced,
          qtyPending: l.qtyPending,
          priceUnit: l.priceUnit,
          subtotal: l.subtotal,
          discount: l.discount,
        })),
      }));
    sendJson(response, 200, { status: "ok", total: orders.length, orders });
  });

  // Asocia pedidos de compra a esta factura (multi-pedido). Solo registro documental del LAB.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/polink", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string; purchaseOrderIds?: number[] } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!body.id || !Array.isArray(body.purchaseOrderIds)) return sendJson(response, 400, { message: "Faltan id o purchaseOrderIds" });
    const doc = inboxService.getDocument(body.id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    const ids = [...new Set(body.purchaseOrderIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))].slice(0, 20);
    if (!doc.extracted) return sendJson(response, 400, { message: "El documento no tiene datos extraídos" });
    (doc as any).assignedPurchaseOrderIds = ids.length ? ids : null;
    const selectedOrders = poLedger.getStore().orders.filter((order) => ids.includes(order.id));
    // Una selección humana vuelve a importar la propuesta completa desde Odoo.
    // No se mezclan líneas de una extracción previa del PDF: se muestran las
    // cantidades, precios, descuentos e impuestos de la fuente confirmada.
    const importedLines = selectedOrders.flatMap((order) => order.lines
      // Si todavía no hay recepción se coteja contra lo pedido, no se oculta
      // la línea. Cuando sí la hay, la cantidad disponible es la recibida.
      .filter((line) => Math.max(0, (line.qtyReceived > 0 ? line.qtyReceived : line.qtyOrdered) - line.qtyInvoiced) > 0)
      .map((line) => {
        const quantity = Math.max(0, (line.qtyReceived > 0 ? line.qtyReceived : line.qtyOrdered) - line.qtyInvoiced);
        const discount = line.discount ?? 0;
        const priceUnit = line.priceUnit;
        const receptionStatus = line.qtyReceived <= 0 ? "sin_recepcion" : line.qtyReceived + 1e-6 < line.qtyOrdered ? "parcial" : "completa";
        return {
          description: line.productName ?? "(producto sin nombre)",
          reference: line.productId != null ? String(line.productId) : null,
          quantity,
          priceUnit,
          discount,
          taxNames: ["IVA pendiente de cotejar"],
          total: Math.round(quantity * priceUnit * (1 - discount / 100) * 100) / 100,
          sourcePurchaseOrder: order.name,
          sourceQtyOrdered: line.qtyOrdered,
          sourceQtyReceived: line.qtyReceived,
          sourceQtyInvoiced: line.qtyInvoiced,
          sourceReceptionStatus: receptionStatus,
          confidence: 100,
        };
      }));
    const previousOrderLines = doc.extracted.lines.filter((line) => Boolean(line.sourcePurchaseOrder)).length;
    doc.extracted.lines = importedLines;
    doc.notes = [...(doc.notes ? [doc.notes] : []), `Pedidos asociados por ${user.name}: ${ids.length ? ids.join(", ") : "ninguno"}`].join("; ").slice(0, 400);
    // Confirmacion humana de pedidos: si hay al menos uno, la factura pasa a validacion.
    if (ids.length && doc.status !== "VALIDADA" && doc.status !== "INCIDENCIA") doc.status = "PENDIENTE_VALIDAR";
    inboxService.save();
    sendJson(response, 200, {
      status: "ok",
      document: doc,
      addedLines: importedLines.length,
      replacedLines: previousOrderLines,
      missingPriceLines: importedLines.filter((line) => !line.priceUnit).length,
    });
  });

  // Refresco explícito y sólo lectura: actualiza las columnas de recepción,
  // pero preserva producto, precio, descuento, IVA y correcciones humanas.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/receipt-refresh", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    const doc = body.id ? inboxService.getDocument(body.id) : null;
    if (!doc || !doc.extracted) return sendJson(response, 404, { message: "Documento no encontrado" });
    if (!(doc.assignedPurchaseOrderIds?.length)) return sendJson(response, 400, { message: "Asocia al menos un pedido antes de actualizar recepciones" });
    try { await poLedger.syncFromOdoo(deps.env); } catch (e) { return sendJson(response, 502, { message: e instanceof Error ? e.message : "No se pudieron leer las recepciones de Odoo" }); }
    const orders = poLedger.getStore().orders.filter((o) => doc.assignedPurchaseOrderIds!.includes(o.id));
    const bySource = new Map<string, typeof orders[number]>();
    orders.forEach((o) => bySource.set(o.name, o));
    let updated = 0;
    doc.extracted.lines = doc.extracted.lines.map((line) => {
      const order = line.sourcePurchaseOrder ? bySource.get(line.sourcePurchaseOrder) : null;
      if (!order) return line;
      const productId = Number(line.reference);
      const candidate = order.lines.find((l) => Number.isFinite(productId) && l.productId === productId)
        ?? order.lines.find((l) => l.productName === line.description);
      if (!candidate) return line;
      updated++;
      return { ...line,
        sourceQtyOrdered: candidate.qtyOrdered,
        sourceQtyReceived: candidate.qtyReceived,
        sourceQtyInvoiced: candidate.qtyInvoiced,
        sourceReceptionStatus: candidate.qtyReceived <= 0 ? "sin_recepcion" : candidate.qtyReceived + 1e-6 < candidate.qtyOrdered ? "parcial" : "completa",
      };
    });
    doc.notes = [...(doc.notes ? [doc.notes] : []), `Recepciones actualizadas desde Odoo por ${user.name}: ${updated} líneas`].join("; ").slice(0, 400);
    inboxService.save();
    sendJson(response, 200, { status: "ok", document: doc, updatedLines: updated });
  });

  // Reclasificacion manual del tipo de documento (factura / albaran / aduana / transporte / otro).
  // Al pasar a factura, se limpia la exclusion y se recoteja.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/doc-type", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string; docType?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!body.id || !body.docType) return sendJson(response, 400, { message: "Faltan id o docType" });
    const docTypes = ["factura", "albaran", "aduana", "transporte", "otro"];
    const docType = String(body.docType).toLowerCase();
    if (!docTypes.includes(docType)) return sendJson(response, 400, { message: "Tipo de documento no permitido" });
    const doc = inboxService.getDocument(body.id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    if (!doc.extracted) return sendJson(response, 400, { message: "El documento no tiene datos extraidos" });
    doc.extracted.docType = docType as PdfExtractedData["docType"];
    doc.notes = [...(doc.notes ? [doc.notes] : []), `Tipo de documento corregido por ${user.name}: ${docType}`].join("; ").slice(0, 400);
    const match = matchDocument(doc, invoiceService.getStore().invoices, buildPoIndex(poLedger.getStore()));
    if (match) {
      doc.match = match;
      if (doc.status !== "VALIDADA" && doc.status !== "INCIDENCIA") {
        const assigned = (doc.assignedPurchaseOrderIds?.length ?? 0) > 0;
        doc.status = !match.excluded && (match.band === "alta" || (assigned && match.band !== "sin")) ? "PENDIENTE_VALIDAR" : "PENDIENTE_COTEJO";
      }
    }
    inboxService.save();
    sendJson(response, 200, { status: "ok", document: doc });
  });

  // ===== Fase 2.4: mini navegador de Drive (alojar PDFs validados) =====

  // Navegacion: subcarpetas de una carpeta (root = bandeja). Solo lectura.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/drive/browse", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const url = new URL(request.url ?? "/", "http://local");
    const client = new DriveClient(deps.env);
    const err = client.configError();
    if (err) return sendJson(response, 400, { message: err });
    try {
      const folderParam = url.searchParams.get("folder");
      const folderId = folderParam || client.getRootFolderId();
      const folders = await client.listFolders(folderId);
      sendJson(response, 200, { status: "ok", folderId, folders: folders.map((f) => ({ id: f.id, name: f.name })) });
    } catch (e) {
      sendJson(response, 502, { message: e instanceof Error ? e.message : "Error de Drive" });
    }
  });

  // Ruta sugerida /AÑO/PROVEEDOR/TRIMESTRE a partir de los datos extraidos.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/drive/suggest", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    const doc = body.id ? inboxService.getDocument(body.id) : undefined;
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    const ex = doc.extracted;
    const dateStr = ex?.invoiceDate ?? doc.detectedAt ?? new Date().toISOString();
    const year = (/^\d{4}/.test(dateStr) ? dateStr.slice(0, 4) : String(new Date().getFullYear()));
    const month = Number(dateStr.slice(5, 7)) || new Date().getMonth() + 1;
    const quarter = `T${Math.min(4, Math.max(1, Math.ceil(month / 3)))}`;
    const supplier = sanitizeFolderName(ex?.supplier ?? "") || "Sin proveedor";
    sendJson(response, 200, { status: "ok", path: [year, supplier, quarter], targetFolderPath: `/${year}/${supplier}/${quarter}` });
  });

  // Crear carpeta en un nivel concreto (idempotente).
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/drive/create-folder", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { parentId?: string; name?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    const name = sanitizeFolderName(String(body.name ?? ""));
    const parentId = String(body.parentId ?? "");
    if (!parentId || !name) return sendJson(response, 400, { message: "Faltan parentId o name" });
    const client = new DriveClient(deps.env);
    const err = client.configError();
    if (err) return sendJson(response, 400, { message: err });
    try {
      const folder = await client.ensureFolder(name, parentId);
      sendJson(response, 200, { status: "ok", folder });
    } catch (e) {
      sendJson(response, 502, { message: e instanceof Error ? e.message : "Error de Drive" });
    }
  });

  // Mover el PDF validado a su carpeta definitiva. Doble seguro: solo al pulsar el boton.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/drive/move", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string; targetFolderId?: string; targetFolderPath?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!body.id || !body.targetFolderId) return sendJson(response, 400, { message: "Faltan id o targetFolderId" });
    const doc = inboxService.getDocument(body.id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    if (doc.status !== "VALIDADA" || !(doc as any).odooDraftMoveId) {
      return sendJson(response, 409, { message: "Guardar en Drive sólo está disponible tras validar la factura y crear el borrador en Odoo" });
    }
    const client = new DriveClient(deps.env);
    const err = client.configError();
    if (err) return sendJson(response, 400, { message: err });
    if (doc.movedTo === body.targetFolderId) return sendJson(response, 400, { message: "El PDF ya esta en esa carpeta" });
    try {
      await client.moveFile(doc.driveFileId, body.targetFolderId);
      doc.movedTo = body.targetFolderId;
      doc.targetFolderPath = body.targetFolderPath ?? null;
      doc.notes = [...(doc.notes ? [doc.notes] : []), `PDF movido a ${body.targetFolderPath ?? body.targetFolderId} por ${user.name}`].join("; ").slice(0, 400);
      inboxService.save();
      sendJson(response, 200, { status: "ok", document: doc });
    } catch (e) {
      sendJson(response, 502, { message: e instanceof Error ? e.message : "Error de Drive" });
    }
  });

  // ===== Fase 3: puente con Odoo (borrador + contabilizar). Puerta de escritura explicita. =====

  // Crea el BORRADOR de factura en Odoo desde un documento VALIDADA.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/odoo-draft", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    if (!odooWriteEnabled(deps.env)) {
      return sendJson(response, 403, { message: "Escritura en Odoo deshabilitada (SUPPLIER_INVOICES_ODOO_WRITE_ENABLED). Se necesita autorizacion explicita." });
    }
    let body: { id?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!body.id) return sendJson(response, 400, { message: "Falta id" });
    const doc = inboxService.getDocument(body.id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    const anyDoc = doc as any;
    if (anyDoc.odooDraftMoveId) return sendJson(response, 400, { message: `Ya existe el borrador ${anyDoc.odooDraftName ?? anyDoc.odooDraftMoveId} en Odoo` });
    if (doc.status !== "VALIDADA") return sendJson(response, 400, { message: `La factura debe estar VALIDADA primero (estado actual: ${doc.status})` });
    let session: { config: import("./odooClient.ts").OdooConfig; uid: number };
    try {
      session = await odooSession(deps.env);
    } catch (e) {
      return sendJson(response, 502, { message: e instanceof Error ? e.message : "No se pudo conectar con Odoo" });
    }
    const orders = poLedger.getStore().orders.map((o) => ({
      id: o.id,
      name: o.name,
      partnerId: o.partnerId,
      partnerName: o.partnerName,
      partnerVat: o.partnerVat,
      amountTotal: o.amountTotal as number | null,
      lines: o.lines.map((l) => ({ productId: l.productId, productName: l.productName, qtyOrdered: l.qtyOrdered, qtyReceived: l.qtyReceived, qtyInvoiced: l.qtyInvoiced, qtyPending: l.qtyPending, priceUnit: l.priceUnit, subtotal: l.subtotal })),
    }));
    try {
      const result: DraftResult = await createSupplierDraft(session.config, session.uid, doc as any, orders);
      if (!result.ok) return sendJson(response, 400, { message: result.message, warnings: result.warnings ?? [] });
      anyDoc.odooDraftMoveId = result.moveId;
      anyDoc.odooDraftName = result.name;
      anyDoc.odooDraftState = result.state;
      doc.notes = [...(doc.notes ? [doc.notes] : []), `Borrador Odoo ${result.name} creado por ${user.name}`].join("; ").slice(0, 400);
      inboxService.save();
      sendJson(response, 200, { status: "ok", result, document: doc });
    } catch (e) {
      sendJson(response, 502, { message: e instanceof Error ? e.message : "Error creando borrador en Odoo" });
    }
  });

  // Contabiliza (posted) el borrador ya creado. Accion explicita del usuario.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/odoo-post", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    if (!odooWriteEnabled(deps.env)) {
      return sendJson(response, 403, { message: "Escritura en Odoo deshabilitada (SUPPLIER_INVOICES_ODOO_WRITE_ENABLED). Se necesita autorizacion explicita." });
    }
    let body: { id?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!body.id) return sendJson(response, 400, { message: "Falta id" });
    const doc = inboxService.getDocument(body.id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    const anyDoc = doc as any;
    if (!anyDoc.odooDraftMoveId) return sendJson(response, 400, { message: "No hay borrador en Odoo para contabilizar" });
    let session: { config: import("./odooClient.ts").OdooConfig; uid: number };
    try {
      session = await odooSession(deps.env);
    } catch (e) {
      return sendJson(response, 502, { message: e instanceof Error ? e.message : "No se pudo conectar con Odoo" });
    }
    try {
      const result: DraftResult = await postSupplierInvoice(session.config, session.uid, Number(anyDoc.odooDraftMoveId));
      if (!result.ok) return sendJson(response, 400, { message: result.message, warnings: result.warnings ?? [] });
      anyDoc.odooDraftState = result.state;
      doc.notes = [...(doc.notes ? [doc.notes] : []), `Factura ${result.name} contabilizada por ${user.name}`].join("; ").slice(0, 400);
      inboxService.save();
      sendJson(response, 200, { status: "ok", result, document: doc });
    } catch (e) {
      sendJson(response, 502, { message: e instanceof Error ? e.message : "Error contabilizando en Odoo" });
    }
  });

  // Descarta un borrador en Odoo (cancelar + eliminar). Solo borradores sin contabilizar.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/odoo-discard", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    if (!odooWriteEnabled(deps.env)) {
      return sendJson(response, 403, { message: "Escritura en Odoo deshabilitada (SUPPLIER_INVOICES_ODOO_WRITE_ENABLED). Se necesita autorizacion explicita." });
    }
    let body: { id?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!body.id) return sendJson(response, 400, { message: "Falta id" });
    const doc = inboxService.getDocument(body.id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    const anyDoc = doc as any;
    if (!anyDoc.odooDraftMoveId) return sendJson(response, 400, { message: "No hay borrador en Odoo para descartar" });
    const moveId = Number(anyDoc.odooDraftMoveId);
    const state = anyDoc.odooDraftState ?? "draft";
    if (state === "posted") return sendJson(response, 400, { message: "La factura ya está contabilizada; no se puede descartar." });
    let session: { config: import("./odooClient.ts").OdooConfig; uid: number };
    try {
      session = await odooSession(deps.env);
    } catch (e) {
      return sendJson(response, 502, { message: e instanceof Error ? e.message : "No se pudo conectar con Odoo" });
    }
    try {
      await discardSupplierDraft(session.config, session.uid, moveId);
      anyDoc.odooDraftMoveId = null;
      anyDoc.odooDraftName = null;
      anyDoc.odooDraftState = null;
      doc.notes = [...(doc.notes ? [doc.notes] : []), `Borrador Odoo ${moveId} descartado por ${user.name}`].join("; ").slice(0, 400);
      inboxService.save();
      sendJson(response, 200, { status: "ok", document: doc });
    } catch (e) {
      sendJson(response, 502, { message: e instanceof Error ? e.message : "Error descartando borrador en Odoo" });
    }
  });

  // Extraccion IA de documentos (texto o escaneado). ids opcional; sin ids, batch de hasta 3 pendientes.
  const runAiExtraction = async (
    user: { name: string },
    ids?: string[],
  ): Promise<{ processed: number; results: { driveFileId: string; name: string; ok: boolean; message: string; confidence: number | null }[] }> => {
    await inboxService.reclassifyDocuments(false);
    const store = inboxService.getStore();
    const docs = (ids?.length
      ? ids.map((id) => inboxService.getDocument(id)).filter((d): d is NonNullable<typeof d> => Boolean(d))
      : store.documents.filter((d) => d.aiStatus !== "ok" && !d.match?.excluded && !(d.extracted?.docType === "aduana" || d.extracted?.docType === "transporte" || d.extracted?.docType === "albaran"))
    ).slice(0, 3);
    const pdfDir = `${deps.dataDir.replace(/\/$/, "")}/supplier-invoices/inbox`;
    const results: { driveFileId: string; name: string; ok: boolean; message: string; confidence: number | null }[] = [];
    for (const doc of docs) {
      const alreadyExcluded = doc.match?.excluded === true || (doc.extracted?.docType === "aduana" || doc.extracted?.docType === "transporte" || doc.extracted?.docType === "albaran");
      // No-facturas detectadas por heuristica no necesitan IA para saber que no son factura.
      if (alreadyExcluded && doc.aiStatus !== "ok") {
        results.push({ driveFileId: doc.driveFileId, name: doc.name, ok: true, message: "No factura (heuristica)", confidence: null });
        continue;
      }
      try {
        const outcome = await aiExtractCachedPdf(deps.env, doc.driveFileId, doc.name, pdfDir);
        let merged = mergeExtracted(doc.extracted, outcome.fields, `Extraccion IA (${outcome.model}, ${outcome.mode})`);
        // Memoria: si este proveedor ya tiene correcciones guardadas, aplicarlas sobre lo extraido.
        const known = mappingStore.get(merged.supplier, merged.supplierVat);
        if (known) {
          merged = {
            ...merged,
            supplier: known.supplierName || merged.supplier,
            supplierVat: known.supplierVat ?? merged.supplierVat,
            country: known.country ?? merged.country,
            billingAddress: merged.billingAddress ?? known.billingAddress,
            warnings: [...merged.warnings, `Mapeo de proveedor aplicado: ${known.supplierName} (memoria ${known.samples})`].slice(0, 8),
          };
        }
        inboxService.applyAiExtraction(doc.driveFileId, merged, "ok", outcome.fields.confidence, null);
        const refreshed = inboxService.getDocument(doc.driveFileId);
        const match = refreshed ? matchDocument(refreshed, invoiceService.getStore().invoices, buildPoIndex(poLedger.getStore())) : null;
        if (refreshed && match) {
          refreshed.match = match;
          inboxService.setStatus(doc.driveFileId, match.band === "alta" ? "PENDIENTE_VALIDAR" : "PENDIENTE_COTEJO", user.name);
        }
        results.push({ driveFileId: doc.driveFileId, name: doc.name, ok: true, message: `${outcome.model}`, confidence: outcome.fields.confidence });
      } catch (error) {
        const message = error instanceof Error ? error.message : "error";
        const current = inboxService.getDocument(doc.driveFileId);
        if (current) inboxService.applyAiExtraction(doc.driveFileId, current.extracted, "error", null, message.slice(0, 200));
        results.push({ driveFileId: doc.driveFileId, name: doc.name, ok: false, message, confidence: null });
      }
    }
    return { processed: results.length, results };
  };

  server.middlewares.use("/api/odoo/supplier-invoices/inbox/extract", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { ids?: string[] } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    const { processed, results } = await runAiExtraction(user, body.ids);
    sendJson(response, 200, { status: "ok", processed, results });
  });

  // ---------- Bandeja documental: lista (DESPUES de las sub-rutas) ----------

  server.middlewares.use("/api/odoo/supplier-invoices/inbox", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const url = new URL(request.url ?? "/", "http://local");
    const store = inboxService.getStore();
    const status = url.searchParams.get("status") ?? "";
    const source = url.searchParams.get("source") ?? "";
    const text = (url.searchParams.get("text") ?? "").toLowerCase();
    const minScore = Number(url.searchParams.get("minScore") ?? 0) || 0;
    const docs = store.documents.filter((d) => {
      if (status && d.status !== status) return false;
      if (source && d.source !== source) return false;
      if (minScore && (d.match?.score ?? 0) < minScore) return false;
      if (text) {
        const hay = [d.name, d.extracted?.supplier, d.extracted?.invoiceNumber, d.match?.purchaseOrderName, d.notes]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    }).sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""));
    sendJson(response, 200, {
      mode: store.documents.length ? "live" : "empty",
      total: docs.length,
      items: docs,
      kpis: inboxService.computeKpis(),
      driveAccount: deps.env.SUPPLIER_INVOICES_DRIVE_ACCOUNT ?? null,
      driveFolderId: deps.env.SUPPLIER_INVOICES_DRIVE_FOLDER_ID ?? null,
      lastScanAt: store.meta.lastScanAt,
      message: store.documents.length ? null : "Bandeja vacía: ejecuta «Cotejar ahora» para leer la carpeta SIN REVISAR de Drive.",
    });
  });

  // ---------- Pedidos sin facturar: sub-rutas (ANTES de la lista) ----------

  server.middlewares.use("/api/odoo/supplier-invoices/unbilled/sync", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    try {
      const meta = await poLedger.syncFromOdoo(deps.env);
      sendJson(response, 200, { status: "ok", meta });
    } catch (error) {
      sendJson(response, 500, { status: "error", message: error instanceof Error ? error.message : "Error sincronizando pedidos" });
    }
  });

  server.middlewares.use("/api/odoo/supplier-invoices/unbilled/detail", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const id = Number(new URL(request.url ?? "/", "http://local").searchParams.get("id") ?? 0);
    const order = enrichedOrders().find((o) => o.id === id);
    if (!order) return sendJson(response, 404, { message: "Pedido no encontrado" });
    // Facturas candidatas en la bandeja para este pedido
    const candidates = inboxService.getStore().documents.filter((d) => d.match?.purchaseOrderId === id);
    sendJson(response, 200, { order, candidates });
  });

  // ---------- Pedidos sin facturar: lista (DESPUES de las sub-rutas) ----------

  server.middlewares.use("/api/odoo/supplier-invoices/unbilled", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const url = new URL(request.url ?? "/", "http://local");
    const all = enrichedOrders();
    const orders = filterOrders(all, {
      status: url.searchParams.get("status"),
      partner: url.searchParams.get("partner"),
      country: url.searchParams.get("country"),
      received: url.searchParams.get("received"),
      over15: url.searchParams.get("over15") === "1" ? true : null,
      text: url.searchParams.get("text"),
    });
    sendJson(response, 200, {
      mode: all.length ? "live" : "empty",
      total: orders.length,
      items: orders,
      kpis: computeUnbilledKpis(all),
      lastPoSyncAt: poLedger.getStore().meta.lastPoSyncAt,
      message: all.length ? null : "Sin pedidos en cache: ejecuta «Sincronizar pedidos» (lectura Odoo).",
    });
  });
}

function readBody(request: any): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    request.on("data", (chunk: string) => { data += chunk; if (data.length > 1e6) request.destroy(); });
    request.on("end", () => resolve(data));
    request.on("error", () => resolve(data));
  });
}
