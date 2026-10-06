// Rutas Fase 2: bandeja documental (Drive + extraccion + cotejo) y pedidos sin facturar.
// SOLO LECTURA de Drive/Odoo. Escritura unicamente del registro documental local del LAB.
// OJO: este middleware es first-match-wins por prefijo. Las sub-rutas especificas
// (/inbox/detail, /inbox/scan, /unbilled/sync...) DEBEN registrarse ANTES que sus listas.

import { createReadStream, existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { spawn } from "node:child_process";
import pdfParse from "pdf-parse";
import { SupplierInvoiceSyncService } from "./service.ts";
import { DocumentInboxService, matchDocument, buildPoIndex, parseDate, normalizeSupplierName, extractPurchaseOrderReferences, extractPurchaseOrderReferenceEvidence } from "./documentInbox.ts";
import { SupplierMappingStore } from "./supplierMappings.ts";
import { odooSession, odooWriteEnabled, createSupplierDraft, discardSupplierDraft, validateAmounts, draftAmountCompletenessError, serviceLineIdentityError } from "./odooBridge.ts";
import type { DraftResult } from "./odooBridge.ts";
import { aiExtractCachedPdf, mergeExtracted } from "./aiExtract.ts";
import { PurchaseOrdersLedger, computeBilling, filterOrders, computeUnbilledKpis } from "./unbilled.ts";
import { DriveClient } from "./driveClient.ts";
import { cotejarPdfConPedidos, preserveOperatorProductSelections, productReferenceTokens, type SupplierProductAlias } from "./pdfPurchaseLines.ts";
import { authenticate, executeKw, getOdooConfig, hasOdooConfig, readRows, searchIds, paginatedRead, searchRead } from "./odooClient.ts";
import { chooseSupplierPrice, type SupplierPriceRow } from "../purchases/supplierPricing.ts";
import { isWebAdjustmentProductId, discountedBase, effectiveDiscount } from "../../shared/supplierInvoiceDiscounts.ts";

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
const round2 = (value: number): number => Math.round(value * 100) / 100;

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
  // Una conversación aislada por factura. No se entrega por Telegram: la
  // respuesta queda en el historial local del documento.
  const raskibotInFlight = new Set<string>();
  const draftInFlight = new Set<string>();

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

  const enrichedOrders = () =>
    computeBilling(poLedger.getStore().orders, invoiceService.getStore().invoices.map((i) => ({
      id: i.id, moveType: i.moveType, state: i.state, amountTotal: i.amountTotal, linkedPurchaseOrderIds: i.linkedPurchaseOrderIds,
    })));

  const normalizedVat = (value: string | null | undefined) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const stripVatCountry = (value: string) => value.length > 9 && /^[A-Z]{2}/.test(value) ? value.slice(2) : value;
  const sameSupplier = (doc: ReturnType<typeof inboxService.getDocument>, partnerName: string, partnerVat: string | null) => {
    const ex = doc?.extracted;
    if (!ex) return false;
    const docVat = normalizedVat(ex.supplierVat);
    const poVat = normalizedVat(partnerVat);
    if (docVat && poVat) return docVat === poVat || stripVatCountry(docVat) === stripVatCountry(poVat);
    return !docVat && Boolean(ex.supplier) && normalizeSupplierName(ex.supplier) === normalizeSupplierName(partnerName);
  };
  // Heuristic extraction can pick the buyer's NIF (often printed before the
  // items) as supplierVat. Resolve it only from a labeled VAT/NIF/CIF placed
  // near the exact Odoo supplier name in the complete PDF text.
  const pdfIssuerVatMatches = (pdfText: string, partnerName: string, partnerVat: string | null) => {
    const targetVat = normalizedVat(partnerVat);
    const words = normalizeSupplierName(partnerName).split(/\s+/).filter(Boolean);
    if (!targetVat || words.length < 2) return false;
    const namePattern = new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^A-Z0-9]{0,12}"), "i");
    const nameMatch = namePattern.exec(pdfText);
    if (!nameMatch) return false;
    const nearby = pdfText.slice(nameMatch.index + nameMatch[0].length, nameMatch.index + nameMatch[0].length + 900);
    for (const label of nearby.matchAll(/\b(?:NIF|CIF|VAT|identif(?:icaci[oó]n)?\.?\s*fiscal)\b/gi)) {
      const valueWindow = nearby.slice(label.index! + label[0].length, label.index! + label[0].length + 90);
      for (const raw of valueWindow.matchAll(/(?:ES)?[A-Z]\s*[- ]?\s*\d(?:[\s-]?\d){7}\b/gi)) {
        const found = normalizedVat(raw[0]);
        if (found === targetVat || stripVatCountry(found) === stripVatCountry(targetVat)) return true;
      }
    }
    return false;
  };
  const pendingOrdersForDocument = (doc: ReturnType<typeof inboxService.getDocument>, pdfText = "") => enrichedOrders()
    .filter((order) => order.state === "purchase" || order.state === "done")
    .filter((order) => order.invoiceStatus === "to invoice" || (order.invoiceStatus == null && (order.billedPct ?? 0) < 99 && (order.pendingAmount ?? 0) > 0.005))
    .filter((order) => Boolean(doc?.confirmedOdooPartnerId && order.partnerId === doc.confirmedOdooPartnerId) || sameSupplier(doc, order.partnerName, order.partnerVat) || pdfIssuerVatMatches(pdfText, order.partnerName, order.partnerVat))
    .sort((a, b) => (b.dateOrder ?? "").localeCompare(a.dateOrder ?? "") || b.id - a.id);

  const catalogCandidatesForDocument = async (doc: ReturnType<typeof inboxService.getDocument>, pdfText = "") => {
    const refs = new Set((doc?.extracted?.lines ?? []).flatMap((line) => productReferenceTokens(line.reference)));
    const barcodeTokens = new Set<string>();
    const supplierCodeTokens = new Set<string>();
    for (const line of doc?.extracted?.lines ?? []) {
      for (const raw of String(line.reference ?? "").split(/[\s\[\](),;:|/]+/)) {
        const normalized = raw.replace(/[^A-Za-z0-9._-]/g, "").trim();
        if (normalized && /\d/.test(normalized)) supplierCodeTokens.add(normalized);
      }
    }
    // First-pass heuristics can miss item codes that Raskibot later sees in the PDF.
    // Only harvest EAN-length numbers and explicitly bracketed SKU-like tokens;
    // arbitrary quantities/prices are not product evidence.
    for (const found of pdfText.matchAll(/(?<![A-Z0-9])(?:\d{8,14}|\[[A-Z0-9][A-Z0-9._/-]{1,}\])(?![A-Z0-9])/gi)) {
      const raw = found[0].replace(/^\[|\]$/g, "");
      for (const token of productReferenceTokens(raw)) refs.add(token);
      if (/^\d{8,14}$/.test(raw)) barcodeTokens.add(raw);
      else supplierCodeTokens.add(raw);
    }
    for (const code of supplierCodeTokens) for (const token of productReferenceTokens(code)) refs.add(token);

    const localProducts: any[] = [];
    try {
      const path = `${deps.dataDir.replace(/\/$/, "")}/products-catalog.json`;
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        const products = Array.isArray(raw?.products) ? raw.products : [];
        const supplier = normalizeSupplierName(doc?.extracted?.supplier ?? "");
        for (const product of products) {
          const productRefs = [...productReferenceTokens(String(product?.reference ?? "")), ...productReferenceTokens(String(product?.barcode ?? ""))];
          const matchedReferences = [...new Set(productRefs.filter((ref) => refs.has(ref)))];
          const supplierHit = supplier && Array.isArray(product?.supplierNames) && product.supplierNames.some((name: unknown) => normalizeSupplierName(String(name)) === supplier);
          if (matchedReferences.length || supplierHit) localProducts.push({ product, matchedReferences, exactRef: matchedReferences.length > 0 });
        }
      }
    } catch { /* La lectura Odoo directa puede suplir una caché local corrupta/ausente. */ }

    let liveProductRead: "read" | "not-configured" | "no-reference" | "failed" = "no-reference";
    let liveProductReadError: string | null = null;
    const remoteProducts: any[] = [];
    const config = getOdooConfig(deps.env);
    if ((barcodeTokens.size || supplierCodeTokens.size) && hasOdooConfig(config)) {
      try {
        const uid = await authenticate(config);
        const fields = ["name", "default_code", "barcode", "type", "active"];
        const [byCode, byBarcode] = await Promise.all([
          supplierCodeTokens.size ? searchRead(config, uid, "product.product", [["active", "=", true], ["default_code", "in", [...supplierCodeTokens]]], fields, { limit: 100, order: "default_code, id" }) : Promise.resolve([]),
          barcodeTokens.size ? searchRead(config, uid, "product.product", [["active", "=", true], ["barcode", "in", [...barcodeTokens]]], fields, { limit: 100, order: "barcode, id" }) : Promise.resolve([]),
        ]);
        remoteProducts.push(...byCode, ...byBarcode);
        liveProductRead = "read";
      } catch (error) {
        liveProductRead = "failed";
        liveProductReadError = error instanceof Error ? error.message.slice(0, 180) : "No se pudo consultar el catálogo Odoo";
      }
    } else if (barcodeTokens.size || supplierCodeTokens.size) liveProductRead = "not-configured";

    const byId = new Map<number, any>();
    for (const { product, matchedReferences, exactRef } of localProducts) {
      const id = Number(product?.id);
      if (!Number.isInteger(id) || id <= 0) continue;
      byId.set(id, { id, templateId: Number(product.templateId ?? 0) || null,
        name: String(product.name ?? "").slice(0, 180), reference: String(product.reference ?? ""),
        barcode: String(product.barcode ?? ""), type: String(product.type ?? ""), exactRef, matchedReferences });
    }
    for (const product of remoteProducts) {
      const id = Number(product?.id);
      if (!Number.isInteger(id) || id <= 0) continue;
      const codes = [...productReferenceTokens(String(product?.default_code ?? "")), ...productReferenceTokens(String(product?.barcode ?? ""))];
      const matchedReferences = [...new Set(codes.filter((code) => refs.has(code)))];
      if (!matchedReferences.length) continue;
      const prior = byId.get(id);
      byId.set(id, { id, templateId: prior?.templateId ?? null,
        name: String(product.name ?? prior?.name ?? "").slice(0, 180), reference: String(product.default_code ?? prior?.reference ?? ""),
        barcode: String(product.barcode ?? prior?.barcode ?? ""), type: String(product.type ?? prior?.type ?? ""), exactRef: true,
        matchedReferences: [...new Set([...(prior?.matchedReferences ?? []), ...matchedReferences])] });
    }
    const candidates = [...byId.values()].sort((a, b) => Number(b.exactRef) - Number(a.exactRef) || a.name.localeCompare(b.name, "es")).slice(0, 100);
    return { candidates, liveProductRead, liveProductReadError };
  };

  const agentOrderCandidatesForDocument = (doc: ReturnType<typeof inboxService.getDocument>, pdfText: string, catalog: Awaited<ReturnType<typeof catalogCandidatesForDocument>>["candidates"]) => {
    const orders = enrichedOrders();
    const referenceEvidence = doc?.extracted ? extractPurchaseOrderReferenceEvidence({ ...doc.extracted, textPreview: pdfText }, orders.map((order) => order.name)) : [];
    const pendingIds = new Set(pendingOrdersForDocument(doc, pdfText).map((order) => order.id));
    const docVat = normalizedVat(doc?.extracted?.supplierVat);
    const containsExact = (value: string | null | undefined) => {
      const ref = String(value ?? "").trim();
      if (ref.length < 4) return false;
      const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`, "i").test(pdfText);
    };
    const rows = orders.map((order) => {
      const explicitOrderName = containsExact(order.name);
      const explicitSupplierRef = containsExact(order.supplierRef);
      const explicitReference = explicitOrderName || explicitSupplierRef;
      const orderVat = normalizedVat(order.partnerVat);
      const pdfIssuerMatch = pdfIssuerVatMatches(pdfText, order.partnerName, order.partnerVat);
      const vatConflict = Boolean(docVat && orderVat && stripVatCountry(docVat) !== stripVatCountry(orderVat) && !pdfIssuerMatch);
      const supplierMatched = sameSupplier(doc, order.partnerName, order.partnerVat) || pdfIssuerMatch;
      const invoiceEligible = pendingIds.has(order.id) && !vatConflict && (order.state === "purchase" || order.state === "done");
      return { order, explicitReference, explicitOrderName, explicitSupplierRef, vatConflict, supplierMatched, invoiceEligible, pdfIssuerMatch };
    });
    const excludedSupplierConflicts = rows.filter((row) => row.vatConflict && row.explicitReference).length;
    // Never hide an exact PDF order-reference hit. A stale/uncertain first-pass
    // supplier identity is a review blocker, not grounds to withhold the evidence.
    // invoiceEligible remains false while the VAT/supplier conflict exists.
    const includedRows = rows.filter((row) => row.explicitReference || (!row.vatConflict && row.invoiceEligible && row.supplierMatched));
    includedRows.sort((a, b) => Number(b.explicitReference) - Number(a.explicitReference)
      || Number(b.invoiceEligible) - Number(a.invoiceEligible)
      || (b.order.dateOrder ?? "").localeCompare(a.order.dateOrder ?? "") || b.order.id - a.order.id);
    const productById = new Map(catalog.map((product) => [product.id, product]));
    const candidates = includedRows.slice(0, 40).map(({ order, explicitReference, explicitOrderName, explicitSupplierRef, invoiceEligible, supplierMatched, vatConflict, pdfIssuerMatch }) => ({
      id: order.id, name: order.name, supplierRef: order.supplierRef ?? null, supplier: order.partnerName, vat: order.partnerVat,
      state: order.state, origin: order.origin, dateOrder: order.dateOrder, total: order.amountTotal,
      pendingAmount: order.pendingAmount, invoiceEligible, explicitReference, supplierMatched, vatConflict,
      explicitReferenceKind: explicitOrderName && explicitSupplierRef ? "order-name-and-supplier-reference" : explicitOrderName ? "order-name" : explicitSupplierRef ? "supplier-reference" : null,
      pdfIssuerVatMatch: pdfIssuerMatch,
      lines: order.lines.slice(0, 80).map((line) => ({
        productId: line.productId, product: line.productName,
        reference: productById.get(Number(line.productId))?.reference ?? null,
        barcode: productById.get(Number(line.productId))?.barcode ?? null,
        qtyOrdered: line.qtyOrdered, qtyReceived: line.qtyReceived,
        qtyInvoiced: line.qtyInvoiced, qtyPending: line.qtyPending, price: line.priceUnit, discount: line.discount,
      })),
    }));
    return { candidates, referenceEvidence, totalCandidates: includedRows.length, explicitMatches: includedRows.filter((row) => row.explicitReference).length,
      pendingSupplierMatches: includedRows.filter((row) => row.invoiceEligible && row.supplierMatched).length,
      excludedSupplierConflicts, omitted: Math.max(0, includedRows.length - candidates.length) };
  };

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

  // Actualiza sólo el inventario de metadatos. Descargar/leer/cotejar un PDF
  // requiere pulsar el botón de IA de ese documento.
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
      sendJson(response, 200, {
        status: "ok",
        ...result,
        autoExtract: null,
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
    body.id = body.id ?? body.driveFileId;
    if (!body.id || !body.status) return sendJson(response, 400, { message: "Faltan id o status" });
    const allowed = ["SIN_REVISAR", "EN_REVISION", "PENDIENTE_COTEJO", "PENDIENTE_VALIDAR", "VALIDADA", "INCIDENCIA"];
    if (!allowed.includes(body.status)) return sendJson(response, 400, { message: "Estado no permitido" });
    const current = inboxService.getDocument(body.id);
    if (!current) return sendJson(response, 404, { message: "Documento no encontrado" });
    if (current.odooDraftMoveId && body.status !== "VALIDADA") return sendJson(response, 409, { message: "El borrador Odoo ya existe; el documento no puede volver a cotejo." });
    if (body.status === "VALIDADA") {
      const ex = current.extracted;
      const assignedIds = current.assignedPurchaseOrderIds ?? [];
      if (!ex || !ex.invoiceNumber || !ex.invoiceDate) return sendJson(response, 409, { message: "Completa número y fecha de factura antes de validar." });
      const services = current.invoiceBranch === "services";
      if (ex.lines.filter((line) => isWebAdjustmentProductId(line.productId)).length > 1) return sendJson(response, 409, { message: "Solo se admite un Ajuste Web por factura." });
      if (services && assignedIds.length) return sendJson(response, 409, { message: "La factura de servicios sin pedido no puede tener pedidos asociados." });
      if (services && !current.confirmedOdooPartnerId) return sendJson(response, 409, { message: "Selecciona y guarda un proveedor existente de Odoo." });
      if (services && current.pdfLinesAccepted === false) return sendJson(response, 409, { message: "Confirma primero que deseas incluir las líneas leídas del PDF sin pedido de compra." });
      if (services && !ex.lines.some((line) => !isWebAdjustmentProductId(line.productId))) return sendJson(response, 409, { message: "Añade al menos una línea contable de servicio o comisión." });
      if (!ex.lines.length) return sendJson(response, 409, { message: "El documento no tiene líneas. Añádelas antes de validar." });
      if (!services && !assignedIds.length) return sendJson(response, 409, { message: "Confirma al menos un pedido pendiente de factura del proveedor o selecciona explícitamente factura de servicios sin pedido." });
      if (!services && hasOdooConfig(getOdooConfig(deps.env))) {
        for (const id of assignedIds) {
          const order = poLedger.getStore().orders.find((row) => row.id === id);
          if (!order) return sendJson(response, 409, { message: `Pedido ${id} no encontrado en el LAB. Revisa la asociación.` });
          try {
            const fresh = await poLedger.refreshOrderByName(deps.env, order.name);
            if (!fresh || fresh.id !== id) return sendJson(response, 409, { message: `No se pudo confirmar ${order.name} en Odoo.` });
          } catch (error) {
            return sendJson(response, 502, { message: error instanceof Error ? error.message : `No se pudo actualizar ${order.name} desde Odoo.` });
          }
        }
      }
      const pendingById = new Map(pendingOrdersForDocument(current).map((order) => [order.id, order]));
      if (assignedIds.some((id) => !pendingById.has(id))) return sendJson(response, 409, { message: "Hay pedidos asociados que ya no están pendientes de factura para este proveedor. Revisa la asociación." });
      const receiptUpdates: { index: number; source: ReturnType<typeof pendingOrdersForDocument>[number]["lines"][number] }[] = [];
      for (let i = 0; i < ex.lines.length; i++) {
        const line = ex.lines[i];
        const adjustment = isWebAdjustmentProductId(line.productId);
        if (adjustment && (line.taxId || line.taxAmount !== 0)) return sendJson(response, 409, { message: `Línea ${i + 1}: el Ajuste Web debe ir sin impuesto y con cuota de IVA cero.` });
        if (!adjustment && (line.priceUnit == null || !Number.isFinite(line.priceUnit) || !line.quantity || line.quantity <= 0)) return sendJson(response, 409, { message: `Línea ${i + 1}: faltan cantidad o precio válidos.` });
        const manualAccountLine = !line.productId && !line.sourcePurchaseOrderId;
        const serviceIdentityError = services && !adjustment && !manualAccountLine ? serviceLineIdentityError(line, i) : null;
        if (serviceIdentityError) return sendJson(response, 409, { message: serviceIdentityError });
        if (!services && !adjustment && !manualAccountLine && (!line.productId || !line.sourcePurchaseOrderId || !assignedIds.includes(line.sourcePurchaseOrderId))) return sendJson(response, 409, { message: `Línea ${i + 1}: enlázala a un producto y pedido confirmados, o déjala como línea contable sin producto.` });
        if (!adjustment && (!line.taxId || !line.accountId || line.taxAmount == null)) return sendJson(response, 409, { message: `Línea ${i + 1}: confirma impuesto, cuota y cuenta contable.` });
        if (!services && !adjustment && !manualAccountLine && line.quantity != null) {
          const sourceOrder = pendingById.get(Number(line.sourcePurchaseOrderId));
          const sourceMatches = sourceOrder?.lines.filter((source) => source.productId === line.productId &&
            source.qtyReceived - source.qtyInvoiced + 0.0001 >= line.quantity) ?? [];
          if (sourceMatches.length !== 1) return sendJson(response, 409, { message: `Línea ${i + 1}: falta una única línea recibida sin facturar en el pedido confirmado.` });
          receiptUpdates.push({ index: i, source: sourceMatches[0] });
        }
      }
      if (services) {
        try {
          const config = getOdooConfig(deps.env);
          if (!hasOdooConfig(config)) return sendJson(response, 502, { message: "Odoo no configurado" });
          const uid = await authenticate(config);
          const [partner] = await readRows(config, uid, "res.partner", [current.confirmedOdooPartnerId!], ["active"]);
          if (!partner || partner.active === false) return sendJson(response, 409, { message: "El proveedor confirmado ya no está activo en Odoo." });
          for (let i = 0; i < ex.lines.length; i++) {
            const line = ex.lines[i];
            if (!line.productId || isWebAdjustmentProductId(line.productId)) continue;
            const [product] = await readRows(config, uid, "product.product", [Number(line.productId)], ["type", "active"]);
            if (!product || product.active === false || !["service", "consu"].includes(String(product.type))) return sendJson(response, 409, { message: `Línea ${i + 1}: el producto no es un servicio/consumible activo de Odoo.` });
          }
        } catch (error) { return sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudo verificar Odoo" }); }
      }
      const amountError = draftAmountCompletenessError(ex.base, ex.taxes, ex.total, ex.lines);
      if (amountError) return sendJson(response, 409, { message: amountError });
      for (const { index, source } of receiptUpdates) Object.assign(ex.lines[index], {
        qtyOrdered: source.qtyOrdered, qtyReceived: source.qtyReceived,
        qtyInvoiced: source.qtyInvoiced, qtyPending: source.qtyPending,
      });
    }
    const doc = inboxService.setStatus(body.id, body.status as any, user.name, body.notes);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    // Validar confirma exclusivamente el cotejo humano. La única escritura es el botón explícito.
    sendJson(response, 200, { status: "ok", document: doc });
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
    const target = store.documents.find((d) => d.driveFileId === body.id);
    if (target) target.match = match;
    inboxService.setStatus(body.id, match && match.band === "alta" ? "PENDIENTE_VALIDAR" : "PENDIENTE_COTEJO", user.name);
    sendJson(response, 200, { status: "ok", match });
  });

  // Edicion local de lineas extraidas (editor de productos, 2.4). Solo persiste el
  // registro documental del LAB; nunca toca Odoo ni Drive.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/lines", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string; manualTaxTotal?: number; lines?: { productId?: number | null; description: string; reference: string | null; quantity: number | null; priceUnit: number | null; discount: number | null; discountExtra?: number | null; promptPaymentDiscount?: number | null; taxNames: string[]; taxId?: number | null; taxRate?: number | null; taxAmount?: number | null; totalWithTax?: number | null; accountId?: number | null; accountName?: string | null; total: number | null; sourcePurchaseOrderId?: number | null; sourcePurchaseOrderName?: string | null; genericProductConfirmed?: boolean; pdfPriceVerified?: boolean; qtyOrdered?: number | null; qtyReceived?: number | null; qtyInvoiced?: number | null; qtyPending?: number | null }[] } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!body.id || !Array.isArray(body.lines)) return sendJson(response, 400, { message: "Faltan id o lines" });
    const doc = inboxService.getDocument(body.id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    if (!doc.extracted) return sendJson(response, 400, { message: "El documento no tiene datos extraidos" });
    if (body.lines.filter((line) => isWebAdjustmentProductId(line.productId)).length > 1) return sendJson(response, 409, { message: "Solo se admite un Ajuste Web por factura." });
    for (const [index, line] of body.lines.entries()) {
      try { effectiveDiscount(line.discount, line.discountExtra, line.promptPaymentDiscount); }
      catch { return sendJson(response, 400, { message: `Línea ${index + 1}: descuento fuera del rango 0–100%.` }); }
      if ([line.discountExtra, line.promptPaymentDiscount].some((rate) => rate != null && Math.abs(rate * 1000 - Math.round(rate * 1000)) > 0.000001))
        return sendJson(response, 400, { message: `Línea ${index + 1}: utiliza como máximo tres decimales en los descuentos adicionales.` });
      if (isWebAdjustmentProductId(line.productId) && ((line.discountExtra ?? 0) !== 0 || (line.promptPaymentDiscount ?? 0) !== 0))
        return sendJson(response, 400, { message: `Línea ${index + 1}: el Ajuste Web no admite descuentos comerciales ni de pronto pago.` });
      if (isWebAdjustmentProductId(line.productId) && (line.taxId || line.taxAmount !== 0))
        return sendJson(response, 400, { message: `Línea ${index + 1}: el Ajuste Web debe ir sin impuesto y con cuota de IVA cero.` });
      if (line.quantity != null && line.priceUnit != null && line.total != null && (line.discountExtra || line.promptPaymentDiscount)
          && Math.abs(discountedBase(line.quantity, line.priceUnit, line.discount, line.discountExtra, line.promptPaymentDiscount) - line.total) > 0.01)
        return sendJson(response, 409, { message: `Línea ${index + 1}: la base no coincide con los descuentos sucesivos. Recalcula la línea antes de guardar.` });
    }
    const usedSourceLines = new Set<number>();
    const oldLines = doc.extracted.lines;
    const clean = body.lines.slice(0, 60).map((l, index) => {
      const matches = (source: typeof oldLines[number], at: number) => !usedSourceLines.has(at)
        && source.productId === l.productId && source.sourcePurchaseOrderId === l.sourcePurchaseOrderId;
      const priorIndex = oldLines[index] && matches(oldLines[index], index) ? index : oldLines.findIndex(matches);
      const prior = priorIndex >= 0 ? oldLines[priorIndex] : null;
      if (priorIndex >= 0) usedSourceLines.add(priorIndex);
      const sameOrigin = Boolean(prior);
      return ({
      productId: typeof l.productId === "number" && Number.isFinite(l.productId) ? Math.floor(l.productId) : null,
      description: String(l.description ?? "").slice(0, 200) || "(concepto)",
      reference: l.reference ? String(l.reference).slice(0, 60) : null,
      quantity: typeof l.quantity === "number" && Number.isFinite(l.quantity) ? Math.round(l.quantity * 100) / 100 : null,
      priceUnit: typeof l.priceUnit === "number" && Number.isFinite(l.priceUnit) ? Math.round(l.priceUnit * 100000) / 100000 : null,
      discount: typeof l.discount === "number" && Number.isFinite(l.discount) ? Math.round(l.discount * 100) / 100 : null,
      discountExtra: typeof l.discountExtra === "number" && Number.isFinite(l.discountExtra) ? Math.round(l.discountExtra * 1000) / 1000 : null,
      promptPaymentDiscount: typeof l.promptPaymentDiscount === "number" && Number.isFinite(l.promptPaymentDiscount) ? Math.round(l.promptPaymentDiscount * 1000) / 1000 : null,
      sourcePurchaseOrderName: l.sourcePurchaseOrderName ? String(l.sourcePurchaseOrderName).slice(0, 60) : null,
      sourcePurchaseOrderId: typeof l.sourcePurchaseOrderId === "number" && Number.isFinite(l.sourcePurchaseOrderId) ? Math.floor(l.sourcePurchaseOrderId) : null,
      genericProductConfirmed: l.genericProductConfirmed === true,
      qtyOrdered: typeof l.qtyOrdered === "number" && Number.isFinite(l.qtyOrdered) ? Math.round(l.qtyOrdered * 100) / 100 : null,
      qtyReceived: typeof l.qtyReceived === "number" && Number.isFinite(l.qtyReceived) ? Math.round(l.qtyReceived * 100) / 100 : null,
      qtyInvoiced: typeof l.qtyInvoiced === "number" && Number.isFinite(l.qtyInvoiced) ? Math.round(l.qtyInvoiced * 100) / 100 : null,
      qtyPending: typeof l.qtyPending === "number" && Number.isFinite(l.qtyPending) ? Math.round(l.qtyPending * 100) / 100 : null,
      // El precio original del pedido no lo proporciona el navegador: conservar
      // sólo la línea de origen que ya quedó importada en el store local.
      odooPurchasePriceUnit: sameOrigin ? prior?.odooPurchasePriceUnit ?? null : null,
      odooPurchaseDiscount: sameOrigin ? prior?.odooPurchaseDiscount ?? null : null,
      pdfPriceVerified: l.pdfPriceVerified === true && l.priceUnit != null && (sameOrigin || l.genericProductConfirmed === true),
      aiProductCandidateId: sameOrigin ? prior?.aiProductCandidateId ?? null : null,
      aiPurchaseOrderCandidateId: sameOrigin ? prior?.aiPurchaseOrderCandidateId ?? null : null,
      aiCandidateReason: sameOrigin ? prior?.aiCandidateReason ?? null : null,
      taxNames: Array.isArray(l.taxNames) ? l.taxNames.filter((t): t is string => typeof t === "string").slice(0, 4) : [],
      taxId: typeof l.taxId === "number" && Number.isFinite(l.taxId) ? Math.floor(l.taxId) : null,
      taxRate: typeof l.taxRate === "number" && Number.isFinite(l.taxRate) ? Math.round(l.taxRate * 100) / 100 : null,
      taxAmount: typeof l.taxAmount === "number" && Number.isFinite(l.taxAmount) ? Math.round(l.taxAmount * 100) / 100 : null,
      totalWithTax: typeof l.totalWithTax === "number" && Number.isFinite(l.totalWithTax) ? Math.round(l.totalWithTax * 100) / 100 : null,
      accountId: typeof l.accountId === "number" && Number.isFinite(l.accountId) ? Math.floor(l.accountId) : null,
      accountName: l.accountName ? String(l.accountName).slice(0, 140) : null,
      total: typeof l.total === "number" && Number.isFinite(l.total) ? Math.round(l.total * 100) / 100 : null,
      confidence: 95,
    }); });

    if (body.manualTaxTotal !== undefined) {
      const requested = body.manualTaxTotal;
      const taxable = clean.filter((line) => !isWebAdjustmentProductId(line.productId));
      const taxIds = new Set(taxable.map((line) => line.taxId));
      const quota = round2(clean.reduce((sum, line) => sum + Number(line.taxAmount ?? 0), 0));
      if (doc.odooDraftMoveId) return sendJson(response, 409, { message: "El borrador Odoo ya existe; ajusta su impuesto directamente en Odoo." });
      if (!Number.isFinite(requested) || requested < 0 || Math.abs(requested * 100 - Math.round(requested * 100)) > 0.000001
          || !taxable.length || taxIds.size !== 1 || !taxable[0].taxId || taxable.some((line) => line.taxAmount == null || line.taxAmount < 0)
          || Math.abs(quota - requested) > 0.005) return sendJson(response, 409, { message: "El impuesto total debe coincidir con las cuotas no negativas de un único impuesto confirmado en las líneas." });
      const base = round2(clean.reduce((sum, line) => sum + Number(line.total ?? 0), 0));
      if (doc.extracted.base == null || Math.abs(base - doc.extracted.base) > 0.01) return sendJson(response, 409, { message: "La base de las líneas no coincide con la base de la factura; guarda primero la base corregida." });
      doc.extracted.taxes = requested;
      doc.extracted.total = round2(base + requested);
    }
    doc.extracted.lines = clean;
    if (doc.invoiceBranch === "services" && doc.confirmedOdooPartnerId && !(doc.assignedPurchaseOrderIds?.length)
        && doc.status !== "VALIDADA" && doc.status !== "INCIDENCIA"
        && validateAmounts(doc.extracted.base, doc.extracted.taxes, doc.extracted.total, clean, []).ok) {
      doc.status = "PENDIENTE_VALIDAR";
    }
    for (const line of clean) {
      if (doc.confirmedOdooPartnerId && line.genericProductConfirmed && line.productId && !isWebAdjustmentProductId(line.productId) && !line.sourcePurchaseOrderId) {
        mappingStore.learnProduct({ supplier: doc.extracted.supplier, vat: doc.extracted.supplierVat, concept: line.description, reference: line.reference, productId: line.productId, sourceDocumentId: doc.driveFileId }, user.name);
      }
    }
    const fiscalLine = clean.find((line) => !isWebAdjustmentProductId(line.productId) && (line.taxId || line.accountId));
    if (fiscalLine) mappingStore.setFiscalDefaults(doc.extracted.supplier, doc.extracted.supplierVat, {
      taxId: fiscalLine.taxId, taxName: fiscalLine.taxNames[0] ?? null,
      accountId: fiscalLine.accountId, accountName: fiscalLine.accountName,
    }, user.name);
    const sum = clean.reduce((acc, l) => acc + (l.total ?? 0), 0);
    doc.notes = [...(doc.notes ? [doc.notes] : []), `Lineas editadas por ${user.name}`].join("; ").slice(0, 400);
    inboxService.save();
    sendJson(response, 200, { status: "ok", document: doc, lines: doc.extracted.lines, total: doc.extracted.total, fiscalDefaults: mappingStore.get(doc.extracted.supplier, doc.extracted.supplierVat) });
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
    const sourceSupplier = ex.supplier;
    const sourceSupplierVat = ex.supplierVat;
    if (f.confirmedOdooPartnerId !== undefined) {
      const partnerId = Number(f.confirmedOdooPartnerId);
      if (partnerId && Number.isInteger(partnerId)) {
        const config = getOdooConfig(deps.env);
        if (!hasOdooConfig(config)) return sendJson(response, 400, { message: "Odoo no configurado" });
        try {
          const uid = await authenticate(config);
          const [partner] = await readRows(config, uid, "res.partner", [partnerId], ["name", "vat", "active"]);
          if (!partner || partner.active === false) return sendJson(response, 409, { message: "El proveedor elegido no está activo en Odoo" });
          const chosenVat = normalizedVat(String(f.supplierVat ?? ex.supplierVat ?? ""));
          const realVat = normalizedVat(String(partner.vat ?? ""));
          if (chosenVat && realVat && stripVatCountry(chosenVat) !== stripVatCountry(realVat)) return sendJson(response, 409, { message: "El NIF no coincide con el proveedor elegido en Odoo" });
          doc.confirmedOdooPartnerId = partnerId;
        } catch (error) { return sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudo verificar el proveedor" }); }
      } else doc.confirmedOdooPartnerId = null;
    } else if ((str(f.supplier) && str(f.supplier) !== ex.supplier) || (str(f.supplierVat) && str(f.supplierVat, 20)?.toUpperCase() !== ex.supplierVat)) {
      doc.confirmedOdooPartnerId = null;
    }
    if (f.invoiceBranch !== undefined) {
      if (f.invoiceBranch !== "goods" && f.invoiceBranch !== "services") return sendJson(response, 400, { message: "Tipo de factura no permitido" });
      doc.invoiceBranch = f.invoiceBranch;
    }
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
    const learned = mappingStore.upsert({ supplier: ex.supplier, vat: ex.supplierVat, country: ex.country, billingAddress: ex.billingAddress, odooPartnerId: doc.confirmedOdooPartnerId ?? null }, user.name);
    mappingStore.learnAlias(sourceSupplier, sourceSupplierVat, learned);
    if (doc.confirmedOdooPartnerId) for (const line of ex.lines) {
      if (line.genericProductConfirmed && line.productId && !isWebAdjustmentProductId(line.productId) && !line.sourcePurchaseOrderId) {
        mappingStore.learnProduct({ supplier: ex.supplier, vat: ex.supplierVat, concept: line.description ?? "", reference: line.reference ?? null, productId: line.productId, sourceDocumentId: doc.driveFileId }, user.name);
      }
    }
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
    if (doc.invoiceBranch === "services" && doc.confirmedOdooPartnerId && !(doc.assignedPurchaseOrderIds?.length)
        && validateAmounts(ex.base, ex.taxes, ex.total, ex.lines, []).ok) targetStatus = "PENDIENTE_VALIDAR";
    if (targetStatus && !doc.odooDraftMoveId && doc.status !== "VALIDADA" && doc.status !== "INCIDENCIA") doc.status = targetStatus;
    inboxService.save();
    sendJson(response, 200, { status: "ok", document: doc, mapping: { learned: true, supplierName: learned.supplierName, samples: learned.samples, defaultTaxId: learned.defaultTaxId ?? null, defaultAccountId: learned.defaultAccountId ?? null } });
  });

  // Registro de mapeos aprendidos por proveedor (solo lectura).
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/mappings", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    sendJson(response, 200, { total: mappingStore.size(), items: mappingStore.list() });
  });

  // Sugerencias de ficha de proveedor directamente desde Odoo. Es una lectura:
  // al elegir una sugerencia solo se rellenan campos del documento/local mapping.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/supplier-suggestions", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const q = (new URL(request.url ?? "/", "http://local").searchParams.get("q") ?? "").trim();
    if (q.length < 3) return sendJson(response, 200, { items: [] });
    const config = getOdooConfig(deps.env);
    if (!hasOdooConfig(config)) return sendJson(response, 400, { message: "Odoo no está configurado para buscar proveedores" });
    try {
      const uid = await authenticate(config);
      const rows = await searchRead(config, uid, "res.partner", [
        "&", ["supplier_rank", ">", 0], "|", ["name", "ilike", q], ["vat", "ilike", q],
      ], ["name", "vat", "country_id", "street", "street2", "zip", "city"], { limit: 8, order: "supplier_rank desc, name" });
      const items = rows.map((row) => {
        const country = Array.isArray(row.country_id) ? String(row.country_id[1] ?? "") : null;
        const address = [row.street, row.street2, [row.zip, row.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
        return { id: Number(row.id), name: String(row.name ?? ""), vat: row.vat ? String(row.vat) : null, country, billingAddress: address };
      });
      sendJson(response, 200, { items });
    } catch (error) {
      sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudieron consultar proveedores en Odoo" });
    }
  });

  // La caché Dashboard omite algunos servicios: búsqueda directa, limitada y de solo lectura.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/service-products", async (request: any, response: any) => {
    if (!requireUser(request, response)) return;
    const url = new URL(request.url ?? "/", "http://local");
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    const id = Number(url.searchParams.get("id"));
    if (q.length < 2 && !(Number.isInteger(id) && id > 0)) return sendJson(response, 200, { products: [] });
    const config = getOdooConfig(deps.env);
    if (!hasOdooConfig(config)) return sendJson(response, 400, { message: "Odoo no configurado" });
    try {
      const uid = await authenticate(config);
      const rows = await searchRead(config, uid, "product.product", id > 0 ? [["id", "=", id], ["active", "=", true], ["type", "in", ["service", "consu"]]] : ["&", ["active", "=", true], "&", ["type", "in", ["service", "consu"]], "|", ["name", "ilike", q], ["default_code", "ilike", q]], ["name", "default_code", "barcode", "type"], { limit: 20, order: "name" });
      sendJson(response, 200, { products: rows.map((row) => ({ id: Number(row.id), name: String(row.name ?? ""), reference: String(row.default_code ?? ""), barcode: String(row.barcode ?? ""), type: String(row.type ?? "") })) });
    } catch (error) { sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudieron buscar servicios en Odoo" }); }
  });

  server.middlewares.use("/api/odoo/supplier-invoices/inbox/product-suggestions", (request: any, response: any) => {
    if (!requireUser(request, response)) return;
    const id = new URL(request.url ?? "/", "http://local").searchParams.get("id") ?? "";
    const doc = inboxService.getDocument(id);
    if (!doc?.extracted) return sendJson(response, 404, { message: "Documento no encontrado" });
    const { supplier, supplierVat, lines } = doc.extracted;
    sendJson(response, 200, { suggestions: lines.map((line) => mappingStore.productSuggestion(supplier, supplierVat, line.description ?? "", line.reference ?? null)) });
  });

  // Catálogos fiscales para el editor local. Sólo se leen de Odoo; guardar una
  // línea no crea ni modifica ningún impuesto ni cuenta contable.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/line-options", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const config = getOdooConfig(deps.env);
    if (!hasOdooConfig(config)) return sendJson(response, 400, { message: "Odoo no está configurado" });
    try {
      const uid = await authenticate(config);
      const [taxRows, accountIds] = await Promise.all([
        searchRead(config, uid, "account.tax", [["active", "=", true], ["type_tax_use", "=", "purchase"]], ["name", "amount", "amount_type", "type_tax_use"], { limit: 100, order: "sequence, name" }),
        // No se limita a las primeras 300: account_id pertenece al plan de
        // cuentas completo. Se excluyen únicamente las cuentas obsoletas.
        searchIds(config, uid, "account.account", [["deprecated", "=", false]], { order: "code, name" }),
      ]);
      const accountRows = await paginatedRead(config, uid, "account.account", accountIds, ["code", "name", "account_type"]);
      accountRows.sort((a, b) => `${a.code ?? ""}\u0000${a.name ?? ""}`.localeCompare(`${b.code ?? ""}\u0000${b.name ?? ""}`, "es"));
      sendJson(response, 200, {
        taxes: taxRows.map((row) => ({ id: Number(row.id), name: String(row.name ?? "Impuesto"), rate: Number(row.amount ?? 0), type: String(row.amount_type ?? "percent") })),
        accounts: accountRows.map((row) => ({ id: Number(row.id), code: String(row.code ?? ""), name: String(row.name ?? ""), type: String(row.account_type ?? "") })),
      });
    } catch (error) {
      sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudieron leer impuestos y cuentas de Odoo" });
    }
  });

  // Enlace de consulta a la ficha real del producto. La URL de Odoo no se expone
  // al frontend ni concede permisos: el navegador sólo recibe una redirección tras
  // pasar la misma sesión autenticada del Dashboard.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/product-candidate", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const url = new URL(request.url ?? "/", "http://local");
    const doc = inboxService.getDocument(url.searchParams.get("id") ?? "");
    const productId = Number(url.searchParams.get("productId"));
    const line = doc?.extracted?.lines.find((item) => item.aiProductCandidateId === productId);
    if (!line || !Number.isInteger(productId) || productId <= 0) return sendJson(response, 404, { message: "Esta línea no tiene esa sugerencia de Raskibot" });
    const config = getOdooConfig(deps.env);
    if (!hasOdooConfig(config)) return sendJson(response, 400, { message: "Odoo no está configurado para verificar el producto sugerido" });
    try {
      const uid = await authenticate(config);
      const rows = await searchRead(config, uid, "product.product", [["id", "=", productId], ["active", "=", true]], ["name", "default_code", "barcode", "type", "active"], { limit: 1 });
      const product = rows[0];
      if (!product || product.active === false) return sendJson(response, 409, { message: "El producto sugerido ya no existe o está archivado en Odoo" });
      const refs = new Set(productReferenceTokens(line.reference));
      const matchedReferences = [...new Set([...productReferenceTokens(String(product.default_code ?? "")), ...productReferenceTokens(String(product.barcode ?? ""))].filter((reference) => refs.has(reference)))];
      if (!matchedReferences.length) return sendJson(response, 409, { message: "La referencia de esta línea no coincide exactamente con el producto actual de Odoo" });
      sendJson(response, 200, { product: { id: productId, name: String(product.name ?? ""), reference: String(product.default_code ?? ""), barcode: String(product.barcode ?? ""), type: String(product.type ?? "") }, matchedReferences });
    } catch (error) { sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudo verificar el producto en Odoo" }); }
  });

  server.middlewares.use("/api/odoo/supplier-invoices/inbox/product-odoo", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const id = Number(new URL(request.url ?? "/", "http://local").searchParams.get("id") ?? 0);
    const base = String(deps.env.ODOO_URL ?? "").replace(/\/+$/, "");
    if (!Number.isInteger(id) || id <= 0 || !base) return sendJson(response, 400, { message: "Producto u Odoo no disponible" });
    response.statusCode = 302;
    response.setHeader("Location", `${base}/web#id=${id}&model=product.product&view_type=form`);
    response.end();
  });

  const supplierPriceWriteEnabled = () => odooWriteEnabled(deps.env)
    && String(deps.env.SUPPLIER_INVOICES_SUPPLIER_PRICE_WRITE_ENABLED ?? "false").toLowerCase() === "true";
  const driveWriteEnabled = (fileId?: string) => String(deps.env.SUPPLIER_INVOICES_DRIVE_WRITE_ENABLED ?? "false").toLowerCase() === "true"
    && (!deps.env.SUPPLIER_INVOICES_DRIVE_ALLOWED_FILE_ID || deps.env.SUPPLIER_INVOICES_DRIVE_ALLOWED_FILE_ID === fileId);

  const loadSupplierPriceContext = async (doc: NonNullable<ReturnType<typeof inboxService.getDocument>>) => {
    const assignedIds = doc.assignedPurchaseOrderIds ?? [];
    if (!doc.extracted || !assignedIds.length) throw new Error("Confirma primero los pedidos de compra de esta factura");
    const pendingOrders = pendingOrdersForDocument(doc);
    const pendingIds = new Set(pendingOrders.map((order) => order.id));
    const staleIds = assignedIds.filter((id) => !pendingIds.has(id));
    if (staleIds.length) throw new Error(`Revisa la asociación: estos pedidos ya no están pendientes para el proveedor: ${staleIds.join(", ")}`);
    const selectedOrders = pendingOrders.filter((order) => assignedIds.includes(order.id));
    const partnerIds = [...new Set(selectedOrders.map((order) => order.partnerId).filter(Boolean))];
    if (!selectedOrders.length || partnerIds.length !== 1) throw new Error("Los pedidos confirmados deben pertenecer a un único proveedor de Odoo");
    const config = getOdooConfig(deps.env);
    if (!hasOdooConfig(config)) throw new Error("Odoo no está configurado");
    const uid = await authenticate(config);
    const productIds = [...new Set(doc.extracted.lines.map((line) => Number(line.productId ?? 0)).filter((id) => id > 0 && !isWebAdjustmentProductId(id)))];
    const productRows = await readRows(config, uid, "product.product", productIds, ["product_tmpl_id", "default_code", "display_name"]);
    const productById = new Map(productRows.map((row) => [Number(row.id), row]));
    const templateIds = [...new Set(productRows.map((row) => Array.isArray(row.product_tmpl_id) ? Number(row.product_tmpl_id[0]) : 0).filter(Boolean))];
    let supportsDiscount = true;
    let supplierRows: Record<string, unknown>[] = [];
    const domain = [["partner_id", "=", partnerIds[0]], ["product_tmpl_id", "in", templateIds]];
    try {
      supplierRows = await searchRead(config, uid, "product.supplierinfo", domain, ["partner_id", "product_tmpl_id", "product_id", "min_qty", "price", "discount", "price_discounted", "currency_id", "sequence", "date_start", "date_end"], { order: "sequence, min_qty desc, id desc" });
    } catch {
      supportsDiscount = false;
      supplierRows = await searchRead(config, uid, "product.supplierinfo", domain, ["partner_id", "product_tmpl_id", "product_id", "min_qty", "price", "currency_id", "sequence", "date_start", "date_end"], { order: "sequence, min_qty desc, id desc" });
    }
    const round2 = (value: number) => Math.round(value * 100) / 100;
    const lines = doc.extracted.lines.map((line, lineIndex) => {
      const productId = Number(line.productId ?? 0);
      const product = productById.get(productId);
      const templateId = Array.isArray(product?.product_tmpl_id) ? Number(product.product_tmpl_id[0]) : 0;
      const chosen = templateId ? chooseSupplierPrice(productId, templateId, supplierRows as SupplierPriceRow[]) as (SupplierPriceRow & { id?: number }) | undefined : undefined;
      const invoicePrice = Number(line.priceUnit ?? 0);
      const invoiceDiscount = Number(line.discount ?? 0);
      const invoiceNet = round2(invoicePrice * (1 - invoiceDiscount / 100));
      const orderPrice = Number(line.odooPurchasePriceUnit ?? line.priceUnit ?? 0);
      const orderDiscount = Number(line.odooPurchaseDiscount ?? line.discount ?? 0);
      const orderNet = round2(orderPrice * (1 - orderDiscount / 100));
      const supplierPrice = chosen ? Number(chosen.price ?? 0) : null;
      const supplierDiscount = chosen && supportsDiscount ? Number(chosen.discount ?? 0) : null;
      const supplierNet = supplierPrice == null ? null : round2(supplierPrice * (1 - (supplierDiscount ?? 0) / 100));
      return {
        lineIndex, productId: productId || null,
        productName: String(product?.display_name ?? line.description ?? ""),
        reference: String(product?.default_code ?? line.reference ?? ""),
        sourcePurchaseOrderId: line.sourcePurchaseOrderId ?? null,
        pdfPriceVerified: line.pdfPriceVerified === true,
        invoicePrice, invoiceDiscount, invoiceNet,
        orderPrice, orderDiscount, orderNet, orderChanged: Math.abs(invoiceNet - orderNet) > 0.005,
        supplierInfoId: chosen?.id ? Number(chosen.id) : null,
        supplierPrice, supplierDiscount, supplierNet,
        supplierChanged: supplierNet == null || Math.abs(invoiceNet - supplierNet) > 0.005,
        currency: Array.isArray(chosen?.currency_id) ? String(chosen.currency_id[1]) : (doc.extracted?.currency ?? "EUR"),
        canUpdate: Boolean(chosen?.id && productId && line.pdfPriceVerified === true),
      };
    });
    const pdfBase = doc.extracted.base;
    const pdfTaxes = doc.extracted.taxes;
    const pdfTotal = doc.extracted.total;
    const lineBase = round2(doc.extracted.lines.reduce((sum, line) => sum + Number(line.quantity ?? 0) * Number(line.priceUnit ?? 0) * (1 - Number(line.discount ?? 0) / 100), 0));
    const lineTaxes = round2(doc.extracted.lines.reduce((sum, line) => sum + Number(line.taxAmount ?? 0), 0));
    const lineTotal = round2(lineBase + lineTaxes);
    const odooBase = round2(selectedOrders.reduce((sum, order) => sum + Number(order.amountUntaxed ?? order.lines.reduce((lineSum, line) => lineSum + line.subtotal, 0)), 0));
    const odooTotal = round2(selectedOrders.reduce((sum, order) => sum + order.amountTotal, 0));
    const odooTaxes = round2(odooTotal - odooBase);
    return {
      config, uid, supportsDiscount, supplierRows,
      lines,
      totals: {
        pdf: { base: pdfBase, taxes: pdfTaxes, total: pdfTotal },
        editor: { base: lineBase, taxes: lineTaxes, total: lineTotal },
        odooOrders: { base: odooBase, taxes: odooTaxes, total: odooTotal, orders: selectedOrders.map((order) => order.name) },
      },
    };
  };

  // Escritura estrecha y explícita: sólo actualiza una tarifa de proveedor ya
  // existente y sólo cuando las dos puertas del LAB están habilitadas.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/supplier-price/update", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    if (!supplierPriceWriteEnabled()) return sendJson(response, 403, { message: "Actualización de precios proveedor bloqueada en LAB. Requiere habilitación y aprobación explícitas." });
    let body: { id?: string; lineIndex?: number } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacío */ }
    const doc = body.id ? inboxService.getDocument(body.id) : null;
    const lineIndex = Number(body.lineIndex);
    if (!doc || !Number.isInteger(lineIndex) || lineIndex < 0) return sendJson(response, 400, { message: "Documento o línea no válidos" });
    try {
      const context = await loadSupplierPriceContext(doc);
      const comparison = context.lines.find((line) => line.lineIndex === lineIndex);
      if (comparison?.pdfPriceVerified !== true) return sendJson(response, 409, { message: "Coteja y confirma el precio del PDF antes de actualizar la tarifa futura." });
      if (!comparison?.supplierInfoId) return sendJson(response, 409, { message: "No existe una tarifa de proveedor en Odoo para actualizar; no se crean registros automáticamente." });
      const vals: Record<string, number> = { price: comparison.invoicePrice };
      if (context.supportsDiscount) vals.discount = comparison.invoiceDiscount;
      const ok = await executeKw(context.config, context.uid, "product.supplierinfo", "write", [[comparison.supplierInfoId], vals], {});
      if (!ok) throw new Error("Odoo no confirmó la actualización");
      const [verified] = await readRows(context.config, context.uid, "product.supplierinfo", [comparison.supplierInfoId], context.supportsDiscount ? ["price", "discount"] : ["price"]);
      const verifiedPrice = Number(verified?.price ?? NaN);
      const verifiedDiscount = context.supportsDiscount ? Number(verified?.discount ?? 0) : comparison.supplierDiscount;
      if (!Number.isFinite(verifiedPrice) || Math.abs(verifiedPrice - comparison.invoicePrice) > 0.005 || (context.supportsDiscount && Math.abs(Number(verifiedDiscount) - comparison.invoiceDiscount) > 0.005)) {
        throw new Error("La verificación posterior de Odoo no coincide con el precio solicitado");
      }
      doc.notes = [...(doc.notes ? [doc.notes] : []), `Precio proveedor Odoo actualizado por ${user.name}: línea ${lineIndex + 1}`].join("; ").slice(0, 400);
      inboxService.save();
      sendJson(response, 200, { status: "ok", message: "Precio proveedor actualizado y verificado en Odoo", price: verifiedPrice, discount: verifiedDiscount });
    } catch (error) {
      sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudo actualizar el precio proveedor" });
    }
  });

  server.middlewares.use("/api/odoo/supplier-invoices/inbox/supplier-prices", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const id = new URL(request.url ?? "/", "http://local").searchParams.get("id") ?? "";
    const doc = inboxService.getDocument(id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    try {
      const context = await loadSupplierPriceContext(doc);
      sendJson(response, 200, { status: "ok", lines: context.lines, totals: context.totals, writeEnabled: supplierPriceWriteEnabled() });
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : "No se pudo cotejar precios" });
    }
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
    let freshness: { source: "live_odoo" | "local_cache"; refreshedAt: string | null; stale: boolean; error: string | null } = { source: "local_cache", refreshedAt: poLedger.getStore().meta.lastPoSyncAt, stale: true, error: null };
    if (doc.confirmedOdooPartnerId && hasOdooConfig(getOdooConfig(deps.env))) {
      try {
        await poLedger.refreshPendingOrdersForPartner(deps.env, doc.confirmedOdooPartnerId);
        freshness = { source: "live_odoo", refreshedAt: new Date().toISOString(), stale: false, error: null };
      } catch (error) {
        return sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudieron actualizar los pedidos del proveedor en Odoo" });
      }
    }
    // La referencia explícita manda: consultar el pedido actual en Odoo antes
    // de mostrar sus líneas, aunque el cache o el mapeo de proveedor esté viejo.
    let referenceText = ex.textPreview ?? "";
    const cachedPdf = `${deps.dataDir.replace(/\/$/, "")}/supplier-invoices/inbox/${doc.driveFileId}.pdf`;
    if (existsSync(cachedPdf)) {
      try { referenceText = String((await pdfParse(readFileSync(cachedPdf))).text ?? ""); }
      catch { /* Conserva la vista previa si el PDF no se puede leer. */ }
    }
    const referenceEvidence = extractPurchaseOrderReferenceEvidence({ ...ex, textPreview: referenceText }, poLedger.getStore().orders.map((order) => order.name));
    const refs = referenceEvidence.map((item) => item.normalized)
      .filter((name) => poLedger.getStore().orders.some((order) => order.name === name) || new RegExp(`\\b${name}\\b`, "i").test(referenceText))
      .slice(0, 10);
    try {
      for (const name of refs) await poLedger.refreshOrderByName(deps.env, name);
    } catch (error) {
      return sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudo leer el pedido actual de Odoo" });
    }
    const explicitNames = new Set(refs);
    // Referencia del proveedor guardada en Odoo: sólo coincidencia literal única
    // en el PDF completo, nunca una aproximación por importe o nombre.
    const supplierRefHits = enrichedOrders().filter((order) => {
      const ref = String(order.supplierRef ?? "").trim();
      if (ref.length < 5) return false;
      const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`, "i").test(referenceText);
    });
    if (supplierRefHits.length === 1) explicitNames.add(supplierRefHits[0].name);
    const orders = enrichedOrders()
      .filter((order) => (order.state === "purchase" || order.state === "done") && (order.invoiceStatus === "to invoice" || (order.invoiceStatus == null && (order.billedPct ?? 0) < 99 && (order.pendingAmount ?? 0) > 0.005)))
      .filter((order) => {
        const docVat = normalizedVat(ex.supplierVat);
        const orderVat = normalizedVat(order.partnerVat);
        const vatConflict = docVat && orderVat && stripVatCountry(docVat) !== stripVatCountry(orderVat);
        const confirmedSupplier = Boolean(doc.confirmedOdooPartnerId && order.partnerId === doc.confirmedOdooPartnerId);
        return confirmedSupplier || (!vatConflict && (explicitNames.has(order.name) || sameSupplier(doc, order.partnerName, order.partnerVat)));
      })
      .sort((a, b) => Number(explicitNames.has(b.name)) - Number(explicitNames.has(a.name)) || (b.dateOrder ?? "").localeCompare(a.dateOrder ?? "") || b.id - a.id)
      .map((o) => ({
        id: o.id,
        name: o.name,
        origin: o.origin ?? null,
        supplierRef: o.supplierRef ?? null,
        dateOrder: o.dateOrder,
        amountTotal: o.amountTotal,
        amountUntaxed: o.amountUntaxed ?? o.lines.reduce((sum, line) => sum + line.subtotal, 0),
        currency: o.currency,
        state: o.state,
        invoiceStatus: o.invoiceStatus ?? null,
        billedAmount: o.billedAmount,
        billedPct: o.billedPct,
        pendingAmount: o.pendingAmount,
        allReceived: o.allReceived,
        lastReceptionAt: o.lastReceptionAt,
        lines: o.lines.map((l) => ({
          id: l.id ?? null,
          productId: l.productId,
          productName: l.productName,
          qtyOrdered: l.qtyOrdered,
          qtyReceived: l.qtyReceived,
          qtyInvoiced: l.qtyInvoiced,
          qtyPending: l.qtyPending,
          priceUnit: l.priceUnit,
          discount: l.discount,
          subtotal: l.subtotal,
          taxIds: l.taxIds ?? [],
        })),
      }));
    const requestedBranch = new URL(request.url ?? "/", "http://local").searchParams.get("branch");
    const branchConflict = (requestedBranch === "services" || doc.invoiceBranch === "services") && referenceEvidence.length > 0;
    sendJson(response, 200, { status: "ok", total: orders.length, freshness, referenceEvidence, branchConflict, explicitReferences: [...explicitNames].filter((name) => orders.some((order) => order.name === name)), orders });
  });

  // Confirmación única del operador: revalida proveedor y pedidos en Odoo y
  // persiste proveedor + cotejo únicamente en el borrador local del LAB.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/confirm-match", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string; confirmedOdooPartnerId?: number; purchaseOrderIds?: number[]; invoiceBranch?: "goods" | "services"; fields?: Record<string, unknown> } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacío */ }
    const doc = body.id ? inboxService.getDocument(body.id) : null;
    if (!doc?.extracted) return sendJson(response, 404, { message: "Documento no encontrado o sin extracción" });
    if (doc.status === "VALIDADA" || doc.odooDraftMoveId) return sendJson(response, 409, { message: "La factura ya está validada o enviada a Odoo." });
    const partnerId = Number(body.confirmedOdooPartnerId ?? 0);
    if (!Number.isInteger(partnerId) || partnerId <= 0) return sendJson(response, 400, { message: "Confirma primero un proveedor existente de Odoo." });
    const suppliedIds = Array.isArray(body.purchaseOrderIds) ? body.purchaseOrderIds : [];
    if (suppliedIds.length > 20) return sendJson(response, 400, { message: "Selecciona como máximo 20 pedidos por factura." });
    const requestedIds = [...new Set(suppliedIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const branch = body.invoiceBranch ?? "goods";
    if (branch !== "goods" && branch !== "services") return sendJson(response, 400, { message: "Tipo de factura no permitido." });
    if (branch === "services" && requestedIds.length) return sendJson(response, 409, { message: "Una factura de servicios no puede asociar pedidos de compra." });
    if (branch === "goods" && !requestedIds.length) return sendJson(response, 409, { message: "Selecciona al menos un pedido o cambia explícitamente a la rama sin pedido." });
    const config = getOdooConfig(deps.env);
    if (!hasOdooConfig(config)) return sendJson(response, 400, { message: "No hay conexión de lectura con Odoo; no se guardó ningún cambio." });

    let verifiedPartner: any;
    let freshOrders: Awaited<ReturnType<typeof poLedger.refreshPendingOrdersForPartner>> = [];
    let aliases: SupplierProductAlias[] = [];
    try {
      const uid = await authenticate(config);
      const [partner] = await readRows(config, uid, "res.partner", [partnerId], ["name", "vat", "active", "country_id"]);
      if (!partner || partner.active === false) return sendJson(response, 409, { message: "El proveedor elegido no está activo en Odoo." });
      const suppliedVat = normalizedVat(String(body.fields?.supplierVat ?? doc.extracted.supplierVat ?? ""));
      const partnerVat = normalizedVat(String(partner.vat ?? ""));
      if (suppliedVat && partnerVat && stripVatCountry(suppliedVat) !== stripVatCountry(partnerVat)) return sendJson(response, 409, { message: "El NIF no coincide con el proveedor elegido en Odoo." });
      verifiedPartner = partner;
      if (branch === "services") {
        let pdfText = doc.extracted.textPreview ?? "";
        const pdfPath = `${deps.dataDir.replace(/\/$/, "")}/supplier-invoices/inbox/${doc.driveFileId}.pdf`;
        if (existsSync(pdfPath)) {
          try { pdfText = String((await pdfParse(readFileSync(pdfPath))).text ?? pdfText); } catch { /* usa texto cacheado */ }
        }
        const refs = extractPurchaseOrderReferenceEvidence({ ...doc.extracted, textPreview: pdfText }, poLedger.getStore().orders.map((order) => order.name));
        if (refs.length) return sendJson(response, 409, { message: `El PDF contiene referencias de compra (${refs.map((item) => item.normalized).join(", ")}). Revisa esas referencias antes de confirmar la rama de servicios.` });
      } else {
        freshOrders = await poLedger.refreshPendingOrdersForPartner(deps.env, partnerId);
        const selected = freshOrders.filter((order) => requestedIds.includes(order.id));
        if (selected.length !== requestedIds.length) return sendJson(response, 409, { message: "Uno o más pedidos ya no están pendientes de facturar para este proveedor. Recarga la lista y revisa la selección." });
        if (selected.some((order) => order.partnerId !== partnerId || !["purchase", "done"].includes(order.state) || order.invoiceStatus !== "to invoice")) return sendJson(response, 409, { message: "Odoo devolvió un pedido no elegible; no se guardó la asociación." });
        const productIds = [...new Set(selected.flatMap((order) => order.lines.map((line) => Number(line.productId ?? 0))).filter((id) => id > 0))];
        if (productIds.length) {
          const products = await readRows(config, uid, "product.product", productIds, ["product_tmpl_id", "default_code", "barcode"]);
          const templateByProduct = new Map(products.map((product) => [Number(product.id), Array.isArray(product.product_tmpl_id) ? Number(product.product_tmpl_id[0]) : 0]));
          for (const product of products) aliases.push({ productId: Number(product.id), reference: typeof product.default_code === "string" ? product.default_code : null, barcode: typeof product.barcode === "string" ? product.barcode : null });
          const templateIds = [...new Set([...templateByProduct.values()].filter((id) => id > 0))];
          if (templateIds.length) {
            const supplierRows = await searchRead(config, uid, "product.supplierinfo", [["partner_id", "=", partnerId], ["product_tmpl_id", "in", templateIds]], ["product_id", "product_tmpl_id", "product_code", "product_name"]);
            for (const supplier of supplierRows) {
              const specificId = Array.isArray(supplier.product_id) ? Number(supplier.product_id[0]) : 0;
              const templateId = Array.isArray(supplier.product_tmpl_id) ? Number(supplier.product_tmpl_id[0]) : 0;
              const matches = specificId ? productIds.filter((id) => id === specificId) : productIds.filter((id) => templateByProduct.get(id) === templateId);
              if (matches.length === 1) aliases.push({ productId: matches[0], reference: typeof supplier.product_code === "string" ? supplier.product_code : null, name: typeof supplier.product_name === "string" ? supplier.product_name : null });
            }
          }
        }
      }
    } catch (error) {
      return sendJson(response, 502, { message: error instanceof Error ? `No se pudo revalidar la selección en Odoo: ${error.message}` : "No se pudo revalidar la selección en Odoo." });
    }

    const f = body.fields ?? {};
    const text = (value: unknown, max = 200) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
    const amount = (value: unknown) => {
      if (value === undefined || value === null || value === "") return null;
      const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    };
    const ex = doc.extracted;
    const priorSupplier = ex.supplier, priorVat = ex.supplierVat;
    ex.supplier = String(verifiedPartner.name ?? "").trim() || ex.supplier;
    ex.supplierVat = String(verifiedPartner.vat ?? "").trim().toUpperCase() || ex.supplierVat;
    ex.country = text(f.country, 20)?.toUpperCase() ?? ex.country;
    ex.invoiceNumber = text(f.invoiceNumber, 60) ?? ex.invoiceNumber;
    if (text(f.invoiceDate, 10)) ex.invoiceDate = parseDate(String(f.invoiceDate));
    if (text(f.dueDate, 10)) ex.dueDate = parseDate(String(f.dueDate));
    ex.currency = text(f.currency, 3)?.toUpperCase() ?? ex.currency;
    ex.billingAddress = text(f.billingAddress) ?? ex.billingAddress;
    for (const key of ["base", "taxes", "total"] as const) if (f[key] !== undefined) ex[key] = amount(f[key]);
    doc.confirmedOdooPartnerId = partnerId;
    doc.invoiceBranch = branch;
    doc.assignedPurchaseOrderIds = requestedIds.length ? requestedIds : null;
    if (branch === "goods" && requestedIds.length) {
      const pdfSourceLines = doc.pdfSourceLines ?? ex.lines.map((line) => ({ ...line }));
      doc.pdfSourceLines = pdfSourceLines;
      const selectedOrders = freshOrders.filter((order) => requestedIds.includes(order.id));
      ex.lines = cotejarPdfConPedidos(preserveOperatorProductSelections(pdfSourceLines, ex.lines), selectedOrders, aliases);
    }
    const learned = mappingStore.upsert({ supplier: ex.supplier, vat: ex.supplierVat, country: ex.country, billingAddress: ex.billingAddress, odooPartnerId: partnerId }, user.name);
    mappingStore.learnAlias(priorSupplier, priorVat, learned);
    doc.match = matchDocument(doc, invoiceService.getStore().invoices, buildPoIndex(poLedger.getStore()));
    if (requestedIds.length && doc.status !== "INCIDENCIA") doc.status = "PENDIENTE_VALIDAR";
    else if (branch === "services" && doc.status !== "INCIDENCIA") doc.status = "PENDIENTE_COTEJO";
    doc.notes = [...(doc.notes ? [doc.notes] : []), `Proveedor y ${requestedIds.length ? "pedidos" : "rama de servicios"} confirmados localmente por ${user.name}`].join("; ").slice(0, 400);
    inboxService.save();
    sendJson(response, 200, { status: "ok", document: doc, freshness: { source: "live_odoo", refreshedAt: new Date().toISOString() }, mapping: { learned: true, supplierName: learned.supplierName } });
  });

  // Asocia pedidos de compra a esta factura (multi-pedido). Solo registro documental del LAB.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/no-po-lines", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    const doc = body.id ? inboxService.getDocument(body.id) : null;
    if (!doc?.extracted) return sendJson(response, 404, { message: "Documento sin líneas de PDF" });
    if (doc.odooDraftMoveId || doc.status === "VALIDADA") return sendJson(response, 409, { message: "La factura ya fue validada o enviada a Odoo" });
    if (doc.assignedPurchaseOrderIds?.length) return sendJson(response, 409, { message: "Quita la asociación de pedidos antes de elegir la rama sin pedido" });
    let referenceText = doc.extracted.textPreview ?? "";
    const cachedPdf = `${deps.dataDir.replace(/\/$/, "")}/supplier-invoices/inbox/${doc.driveFileId}.pdf`;
    if (existsSync(cachedPdf)) {
      try { referenceText = String((await pdfParse(readFileSync(cachedPdf))).text ?? ""); }
      catch { /* Mantiene la vista previa si el PDF no se puede leer. */ }
    }
    const knownOrder = extractPurchaseOrderReferences({ ...doc.extracted, textPreview: referenceText }, poLedger.getStore().orders.map((order) => order.name))
      .find((name) => poLedger.getStore().orders.some((order) => order.name === name));
    if (knownOrder) return sendJson(response, 409, { message: `El PDF identifica el pedido ${knownOrder}. Asócialo y coteja sus productos Odoo antes de incluir líneas sin pedido.` });
    if (!doc.extracted.lines.length) return sendJson(response, 409, { message: "No se detectaron líneas en el PDF; revísalo antes de continuar" });
    doc.invoiceBranch = "services";
    doc.pdfLinesAccepted = true;
    inboxService.save();
    sendJson(response, 200, { status: "ok", document: doc });
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
    const requestedIds = [...new Set(body.purchaseOrderIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))].slice(0, 20);
    if (hasOdooConfig(getOdooConfig(deps.env))) {
      const requestedOrders = requestedIds.map((id) => poLedger.getStore().orders.find((order) => order.id === id));
      if (requestedOrders.some((order) => !order)) return sendJson(response, 409, { message: "Un pedido seleccionado ya no está en la lista actual. Vuelve a cargar los pedidos." });
      try {
        for (const order of requestedOrders) await poLedger.refreshOrderByName(deps.env, order!.name);
      } catch (error) {
        return sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudieron actualizar los pedidos antes de asociarlos" });
      }
    }
    const allowedIds = new Set(pendingOrdersForDocument(doc).map((order) => order.id));
    const invalidIds = requestedIds.filter((id) => !allowedIds.has(id));
    if (invalidIds.length) return sendJson(response, 400, { message: `Estos pedidos no están pendientes de factura para el proveedor confirmado: ${invalidIds.join(", ")}` });
    const ids = requestedIds;
    (doc as any).assignedPurchaseOrderIds = ids.length ? ids : null;
    // La confirmación humana importa líneas reales de Odoo, sin perder los precios leídos del PDF.
    // No se deduplica: dos líneas iguales de pedidos distintos siguen siendo trazables.
    if (doc.extracted && ids.length) {
      const pdfSourceLines = doc.pdfSourceLines ?? doc.extracted.lines.map((line) => ({ ...line }));
      const pdfLines = preserveOperatorProductSelections(pdfSourceLines, doc.extracted.lines);
      const selectedOrders = poLedger.getStore().orders.filter((order) => ids.includes(order.id));
      const aliases: SupplierProductAlias[] = [];
      const config = getOdooConfig(deps.env);
      if (hasOdooConfig(config)) {
        try {
          const uid = await authenticate(config);
          const productIds = [...new Set(selectedOrders.flatMap((order) => order.lines.map((line) => Number(line.productId ?? 0))).filter((id) => id > 0))];
          const products = await readRows(config, uid, "product.product", productIds, ["product_tmpl_id", "default_code", "barcode"]);
          const templateByProduct = new Map(products.map((product) => [Number(product.id), Array.isArray(product.product_tmpl_id) ? Number(product.product_tmpl_id[0]) : 0]));
          for (const product of products) aliases.push({ productId: Number(product.id), reference: typeof product.default_code === "string" ? product.default_code : null, barcode: typeof product.barcode === "string" ? product.barcode : null });
          const templateIds = [...new Set([...templateByProduct.values()].filter((id) => id > 0))];
          const partnerId = Number(doc.confirmedOdooPartnerId ?? selectedOrders[0]?.partnerId ?? 0);
          if (partnerId && templateIds.length) {
            const supplierRows = await searchRead(config, uid, "product.supplierinfo", [["partner_id", "=", partnerId], ["product_tmpl_id", "in", templateIds]], ["product_id", "product_tmpl_id", "product_code", "product_name"]);
            for (const supplier of supplierRows) {
              const specificId = Array.isArray(supplier.product_id) ? Number(supplier.product_id[0]) : 0;
              const templateId = Array.isArray(supplier.product_tmpl_id) ? Number(supplier.product_tmpl_id[0]) : 0;
              const matches = specificId ? productIds.filter((id) => id === specificId) : productIds.filter((id) => templateByProduct.get(id) === templateId);
              if (matches.length !== 1) continue;
              aliases.push({ productId: matches[0], reference: typeof supplier.product_code === "string" ? supplier.product_code : null, name: typeof supplier.product_name === "string" ? supplier.product_name : null });
            }
          }
        } catch (error) {
          return sendJson(response, 502, { message: `No se pudieron comprobar las referencias de proveedor en Odoo: ${error instanceof Error ? error.message : "error de lectura"}` });
        }
      }
      doc.pdfSourceLines = pdfSourceLines;
      doc.extracted.lines = cotejarPdfConPedidos(pdfLines, selectedOrders, aliases);
      const defaults = mappingStore.get(doc.extracted.supplier, doc.extracted.supplierVat);
      if (defaults) doc.extracted.lines = doc.extracted.lines.map((line) => isWebAdjustmentProductId(line.productId) ? line : ({
        ...line,
        taxId: defaults.defaultTaxId ?? line.taxId,
        taxNames: defaults.defaultTaxName ? [defaults.defaultTaxName] : line.taxNames,
        accountId: defaults.defaultAccountId ?? line.accountId,
        accountName: defaults.defaultAccountName ?? line.accountName,
      }));
    }
    doc.notes = [...(doc.notes ? [doc.notes] : []), `Pedidos asociados por ${user.name}: ${ids.length ? ids.join(", ") : "ninguno"}`].join("; ").slice(0, 400);
    // Confirmacion humana de pedidos: si hay al menos uno, la factura pasa a validacion.
    if (ids.length && doc.status !== "VALIDADA" && doc.status !== "INCIDENCIA") doc.status = "PENDIENTE_VALIDAR";
    inboxService.save();
    sendJson(response, 200, { status: "ok", document: doc });
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
      if (!doc.odooDraftMoveId && doc.status !== "VALIDADA" && doc.status !== "INCIDENCIA") {
        const assigned = (doc.assignedPurchaseOrderIds?.length ?? 0) > 0;
        doc.status = !match.excluded && (match.band === "alta" || (assigned && match.band !== "sin")) ? "PENDIENTE_VALIDAR" : "PENDIENTE_COTEJO";
      }
    }
    inboxService.save();
    sendJson(response, 200, { status: "ok", document: doc });
  });

  // ===== Fase 2.4: mini navegador de Drive (alojar PDFs validados) =====

  // Navegacion: solo dentro de FACTURAS; la bandeja de entrada queda separada.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/drive/browse", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const url = new URL(request.url ?? "/", "http://local");
    const client = new DriveClient(deps.env);
    const err = client.configError();
    if (err) return sendJson(response, 400, { message: err });
    try {
      const folderParam = url.searchParams.get("folder");
      const folderId = folderParam || client.getArchiveFolderId();
      const path = await client.archivePath(folderId);
      const folders = await client.listFolders(folderId);
      sendJson(response, 200, { status: "ok", folderId, path, folders: folders.map((f) => ({ id: f.id, name: f.name })) });
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
    let body: { id?: string; parentId?: string; name?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!driveWriteEnabled(body.id)) return sendJson(response, 403, { message: "Escritura en Drive no autorizada para esta factura." });
    const doc = body.id ? inboxService.getDocument(body.id) : null;
    if (!doc || doc.status !== "VALIDADA" || !doc.odooDraftMoveId) return sendJson(response, 409, { message: "Sólo se crean carpetas cuando la factura está validada y ya tiene borrador Odoo." });
    if (doc.movedTo) return sendJson(response, 409, { message: "El PDF ya está archivado en Drive." });
    const name = sanitizeFolderName(String(body.name ?? ""));
    const parentId = String(body.parentId ?? "");
    if (!parentId || !name) return sendJson(response, 400, { message: "Faltan parentId o name" });
    const client = new DriveClient(deps.env);
    const err = client.configError();
    if (err) return sendJson(response, 400, { message: err });
    try {
      await client.archivePath(parentId);
      const folder = await client.ensureFolder(name, parentId);
      const path = await client.archivePath(folder.id);
      sendJson(response, 200, { status: "ok", folder, path });
    } catch (e) {
      sendJson(response, 502, { message: e instanceof Error ? e.message : "Error de Drive" });
    }
  });

  // Mover el PDF validado a su carpeta definitiva. Doble seguro: solo al pulsar el boton.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/drive/move", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string; targetFolderId?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!driveWriteEnabled(body.id)) return sendJson(response, 403, { message: "Escritura en Drive no autorizada para esta factura." });
    if (!body.id || !body.targetFolderId) return sendJson(response, 400, { message: "Faltan id o targetFolderId" });
    const doc = inboxService.getDocument(body.id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    // El borrador sólo pudo crearse tras VALIDADA. No perder la posibilidad de
    // archivar si un recotejo antiguo degradó el estado local después.
    if (!doc.odooDraftMoveId) return sendJson(response, 409, { message: "Guardar en Drive requiere factura validada y borrador Odoo existente." });
    const client = new DriveClient(deps.env);
    const err = client.configError();
    if (err) return sendJson(response, 400, { message: err });
    if (doc.movedTo) return sendJson(response, 409, { message: "El PDF ya está archivado en Drive." });
    try {
      const targetFolderPath = await client.archivePath(body.targetFolderId);
      if (body.targetFolderId === client.getArchiveFolderId()) return sendJson(response, 400, { message: "Selecciona una subcarpeta dentro de FACTURAS." });
      await client.moveFile(doc.driveFileId, body.targetFolderId);
      doc.movedTo = body.targetFolderId;
      doc.targetFolderPath = targetFolderPath;
      doc.notes = [...(doc.notes ? [doc.notes] : []), `PDF movido a ${targetFolderPath} por ${user.name}`].join("; ").slice(0, 400);
      inboxService.save();
      sendJson(response, 200, { status: "ok", document: doc, targetFolderPath });
    } catch (e) {
      sendJson(response, 502, { message: e instanceof Error ? e.message : "Error de Drive" });
    }
  });

  // ===== Fase 3: puente con Odoo (borrador + contabilizar). Puerta de escritura explicita. =====

  // Enlace de solo lectura a la factura creada. Usa el ID guardado tras la
  // respuesta de Odoo, nunca una referencia o un ID suministrado por el navegador.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/odoo-draft-open", (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "GET").toUpperCase() !== "GET") return sendJson(response, 405, { message: "Usa GET" });
    const fileId = new URL(request.url ?? "/", "http://localhost").searchParams.get("id");
    const doc = fileId ? inboxService.getDocument(fileId) : null;
    const moveId = Number(doc?.odooDraftMoveId ?? 0);
    const base = String(deps.env.ODOO_URL ?? "").replace(/\/+$/, "");
    if (!doc || !Number.isInteger(moveId) || moveId <= 0 || !base) return sendJson(response, 404, { message: "Borrador Odoo no disponible" });
    response.statusCode = 302;
    response.setHeader("Location", `${base}/web#id=${moveId}&model=account.move&view_type=form`);
    response.end();
  });

  server.middlewares.use("/api/odoo/supplier-invoices/inbox/odoo-draft-capability", (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "GET").toUpperCase() !== "GET") return sendJson(response, 405, { message: "Usa GET" });
    const id = new URL(request.url ?? "/", "http://localhost").searchParams.get("id");
    if (!id || !inboxService.getDocument(id)) return sendJson(response, 404, { message: "Documento no encontrado" });
    sendJson(response, 200, { enabled: odooWriteEnabled(deps.env) && (!deps.env.SUPPLIER_INVOICES_ODOO_ALLOWED_FILE_ID || deps.env.SUPPLIER_INVOICES_ODOO_ALLOWED_FILE_ID === id) });
  });

  // Crea el BORRADOR de factura en Odoo desde un documento VALIDADA.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/odoo-draft", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    if (!odooWriteEnabled(deps.env)) {
      return sendJson(response, 403, { message: "Escritura en Odoo deshabilitada (SUPPLIER_INVOICES_ODOO_WRITE_ENABLED). Se necesita autorizacion explicita." });
    }
    let body: { id?: string; accountingDate?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!body.id) return sendJson(response, 400, { message: "Falta id" });
    if (!body.accountingDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.accountingDate)) return sendJson(response, 400, { message: "Selecciona y confirma la fecha contable del borrador." });
    if (deps.env.SUPPLIER_INVOICES_ODOO_ALLOWED_FILE_ID && body.id !== deps.env.SUPPLIER_INVOICES_ODOO_ALLOWED_FILE_ID) return sendJson(response, 403, { message: "La autorización de escritura del LAB está limitada a otra factura." });
    const doc = inboxService.getDocument(body.id);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
    const anyDoc = doc as any;
    if (anyDoc.odooDraftMoveId) return sendJson(response, 400, { message: `Ya existe el borrador ${anyDoc.odooDraftName ?? anyDoc.odooDraftMoveId} en Odoo` });
    if (doc.status !== "VALIDADA") return sendJson(response, 400, { message: `La factura debe estar VALIDADA primero (estado actual: ${doc.status})` });
    if (draftInFlight.has(body.id)) return sendJson(response, 409, { message: "Ya se está creando un borrador para esta factura." });
    draftInFlight.add(body.id);
    try {
    let session: { config: import("./odooClient.ts").OdooConfig; uid: number };
    try {
      session = await odooSession(deps.env);
    } catch (e) {
      return sendJson(response, 502, { message: e instanceof Error ? e.message : "No se pudo conectar con Odoo" });
    }
    for (const id of doc.assignedPurchaseOrderIds ?? []) {
      const order = poLedger.getStore().orders.find((row) => row.id === id);
      if (!order) return sendJson(response, 409, { message: `Pedido ${id} no encontrado en el LAB. Revisa la asociación.` });
      try {
        const fresh = await poLedger.refreshOrderByName(deps.env, order.name);
        if (!fresh || fresh.id !== id) return sendJson(response, 409, { message: `No se pudo confirmar ${order.name} en Odoo.` });
      } catch (error) {
        return sendJson(response, 502, { message: error instanceof Error ? error.message : `No se pudo actualizar ${order.name}` });
      }
    }
    const orders = poLedger.getStore().orders.map((o) => ({
      id: o.id,
      name: o.name,
      partnerId: o.partnerId,
      partnerName: o.partnerName,
      partnerVat: o.partnerVat,
      amountTotal: o.amountTotal as number | null,
      lines: o.lines.map((l) => ({ productId: l.productId, productName: l.productName, qtyOrdered: l.qtyOrdered, qtyReceived: l.qtyReceived, qtyInvoiced: l.qtyInvoiced, qtyPending: l.qtyPending, priceUnit: l.priceUnit, subtotal: l.subtotal, taxIds: l.taxIds ?? [] })),
    }));
    try {
      const result: DraftResult = await createSupplierDraft(session.config, session.uid, doc as any, orders, body.accountingDate!);
      if (!result.ok) return sendJson(response, 400, { message: result.message, warnings: result.warnings ?? [] });
      anyDoc.odooDraftMoveId = result.moveId;
      anyDoc.odooDraftName = result.name;
      anyDoc.odooDraftState = result.state;
      anyDoc.odooDraftActual = result.actual ?? null;
      doc.notes = [...(doc.notes ? [doc.notes] : []), `Borrador Odoo ${result.name} creado por ${user.name}`].join("; ").slice(0, 400);
      inboxService.save();
      sendJson(response, 200, { status: "ok", result, document: doc });
    } catch (e) {
      sendJson(response, 502, { message: e instanceof Error ? e.message : "Error creando borrador en Odoo" });
    }
    } finally {
      draftInFlight.delete(body.id);
    }
  });

  // El operador valida/contabiliza el borrador exclusivamente dentro de Odoo.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/odoo-post", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    sendJson(response, 403, { message: "La validación y contabilización se realizan únicamente en Odoo, no desde Dashboard." });
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
    if (deps.env.SUPPLIER_INVOICES_ODOO_ALLOWED_FILE_ID && body.id !== deps.env.SUPPLIER_INVOICES_ODOO_ALLOWED_FILE_ID) return sendJson(response, 403, { message: "La autorización de escritura del LAB está limitada a otra factura." });
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
        if (refreshed && known?.odooPartnerId && Number.isInteger(known.odooPartnerId) && known.odooPartnerId > 0) {
          // Una equivalencia previamente confirmada por el operario se puede rellenar automáticamente.
          // El borrador vuelve a comprobar que el proveedor siga activo en Odoo antes de escribir.
          refreshed.confirmedOdooPartnerId = known.odooPartnerId;
          inboxService.save();
        }
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
    let body: { ids?: string[]; question?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    const { processed, results } = await runAiExtraction(user, body.ids);
    sendJson(response, 200, { status: "ok", processed, results });
  });

  // Delega el análisis humano-asistido al agente de cotejo. No se usa Telegram
  // ni callback: el proceso devuelve JSON y este servidor conserva sólo las
  // propuestas locales. Raskibot no recibe credenciales ni permisos de Odoo.
  server.middlewares.use("/api/odoo/supplier-invoices/inbox/raskibot-extract", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { ids?: string[]; question?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    // Una invocación = una factura = un hilo. Reutilizar la misma respuesta para
    // varios PDFs contaminaría sus borradores y conversaciones.
    if (body.ids && body.ids.length !== 1) return sendJson(response, 400, { message: "Analiza una factura por vez para mantener su hilo y propuesta separados." });
    if (!body.ids?.length) return sendJson(response, 400, { message: "Elige un documento y pulsa «Escanear con IA»." });
    const ids = body.ids.map(String).filter(Boolean);
    const docs = ids.map((id) => inboxService.getDocument(id)).filter((d): d is NonNullable<typeof d> => Boolean(d));
    if (!docs.length) return sendJson(response, 404, { message: "Documento no encontrado" });
    if (docs.some((d) => raskibotInFlight.has(d.driveFileId))) return sendJson(response, 409, { message: "Raskibot ya está analizando esta factura. Espera a que termine." });
    try {
      await inboxService.prepareForReview(docs[0].driveFileId, deps.env, invoiceService.getStore().invoices, buildPoIndex(poLedger.getStore()));
    } catch (error) {
      return sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudo leer el PDF elegido" });
    }
    const pdfDir = `${deps.dataDir.replace(/\/$/, "")}/supplier-invoices/inbox`;
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 1000) : "";
    if (question) docs.forEach((d) => {
      d.reviewChat = [...(d.reviewChat ?? []), { at: new Date().toISOString(), role: "user", content: question }].slice(-60);
    });
    // El agente debe disponer del mismo contenido que el operador adjunta por
    // Telegram. `textPreview` es deliberadamente corto para la lista y no
    // alcanza para cotejar todas las líneas de una factura. El PDF nunca sale
    // por Telegram: se lee desde la caché local del LAB y el texto se entrega
    // únicamente al proceso interno de Raskibot.
    const documentsForAgent = await Promise.all(docs.map(async (d) => {
      const pdfPath = `${pdfDir}/${d.driveFileId}.pdf`;
      let pdfText = "";
      let pdfTextComplete = false;
      try {
        if (existsSync(pdfPath)) {
          const completeText = String((await pdfParse(readFileSync(pdfPath))).text ?? "");
          if (completeText.trim()) { pdfText = completeText; pdfTextComplete = true; }
          else pdfText = d.extracted?.textPreview ?? "";
        } else pdfText = d.extracted?.textPreview ?? "";
      } catch {
        pdfText = d.extracted?.textPreview ?? "";
      }
      let liveOrderRead: "refreshed" | "not-configured" | "no-explicit-hit" | "failed" = "no-explicit-hit";
      let orderRefreshError: string | null = null;
      const explicitSupplierRefOrders = enrichedOrders().filter((order) => {
        const ref = String(order.supplierRef ?? "").trim();
        if (ref.length < 4) return false;
        const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`, "i").test(pdfText);
      }).slice(0, 4);
      if (explicitSupplierRefOrders.length && !hasOdooConfig(getOdooConfig(deps.env))) liveOrderRead = "not-configured";
      if (explicitSupplierRefOrders.length && hasOdooConfig(getOdooConfig(deps.env))) {
        try {
          for (const order of explicitSupplierRefOrders) await poLedger.refreshOrderByName(deps.env, order.name);
          liveOrderRead = "refreshed";
        } catch (error) {
          liveOrderRead = "failed";
          orderRefreshError = error instanceof Error ? error.message.slice(0, 180) : "No se pudo releer el pedido explícito";
        }
      }
      const catalogContext = await catalogCandidatesForDocument(d, pdfText);
      const catalogCandidates = catalogContext.candidates;
      const orderContext = agentOrderCandidatesForDocument(d, pdfText, catalogCandidates);
      return {
        id: d.driveFileId,
        name: d.name,
        pdfPath,
        pdfText,
        extracted: d.extracted,
        currentMatch: d.match,
        reviewChat: (d.reviewChat ?? []).slice(-20),
        // Candidatos preparados por el backend: pedidos actuales del proveedor y coincidencias
        // exactas de referencia. Las cantidades/precios describen diferencias; no definen identidad.
        purchaseOrderCandidates: orderContext.candidates,
        purchaseOrderReferenceEvidence: orderContext.referenceEvidence,
        candidateDiagnostics: {
          source: "LAB purchase-order ledger + exact Odoo product lookup", pdfTextComplete, liveOrderRead, orderRefreshError,
          liveProductRead: catalogContext.liveProductRead, liveProductReadError: catalogContext.liveProductReadError,
          purchaseOrderCandidates: orderContext.totalCandidates, explicitOrderMatches: orderContext.explicitMatches,
          pendingSupplierMatches: orderContext.pendingSupplierMatches, excludedSupplierConflicts: orderContext.excludedSupplierConflicts,
          omittedPurchaseOrders: orderContext.omitted, catalogCandidates: catalogCandidates.length,
        },
        catalogCandidates,
      };
    }));
    const task = {
      task: question ? `Responde esta duda del operador sobre la factura: ${question}` : "Extrae y coteja esta factura. Señala con claridad toda duda que requiera decisión humana.",
      rules: ["Misión: eres el analista de facturas proveedor del operador. Lee primero pdfText completo y, si queda una duda, el PDF local indicado por pdfPath; no te limites a extracted/textPreview. reviewChat es historial, no evidencia: prevalecen el PDF completo y los candidatos actuales.", "Puedes proponer correcciones estructuradas del borrador local del Dashboard basadas solo en el PDF. Devuelve la propuesta; no escribas directamente en el Dashboard, sus stores, Odoo ni Drive. La persona revisará y aplicará la propuesta por una ruta autenticada separada. Nunca confirmes proveedor, pedido o producto; conserva los campos y líneas ya confirmados por el operario y declara dudas.", "Usa purchaseOrderCandidates y candidateDiagnostics como evidencia preparada por el backend. Antes de afirmar que no hay candidatos, comprueba los arrays recibidos y cita sus contadores. Prioriza la coincidencia exacta de name o supplierRef con el texto PDF completo. El backend puede incluir una referencia exacta aunque supplierMatched=false o vatConflict=true: es evidencia para investigar, NO permiso de asociar ni contabilizar; coteja CIF/NIF del emisor en el PDF y solo propón como invoiceEligible un candidato sin conflicto. Si faltan datos o hay conflicto sin resolver, dilo como pendiente y no ocultes la referencia exacta.", "Compara la referencia del PDF con name (nuestro pedido P...) y supplierRef (referencia del proveedor guardada en Odoo). Prioriza coincidencia exacta única; no confundas código postal, CIF, factura ni referencia de producto con un pedido. Ante varias coincidencias, no asignes ninguno.", "Localiza referencias explícitas de pedidos de compra en el PDF y explica qué pedido pendiente corresponde a cada referencia; usa para facturar solo candidatos con invoiceEligible=true. Si existe una referencia identificable pero invoiceEligible=false, explica si está ya facturada/no elegible y no la propongas para asociar.", "Para cada línea, compara por separado todos los códigos del PDF (EAN, referencia del proveedor y otros tokens) con reference/barcode/default_code de los productos y las líneas de compra. Revisa catalogCandidates.matchedReferences: cada elemento es una coincidencia literal entre el PDF y el catálogo, así que no digas que el catálogo está vacío si esos candidatos existen. Si no hay coincidencias y candidateDiagnostics.liveProductRead es failed o not-configured, indica que no pudo confirmarse en Odoo en vivo; si es read, limita la conclusión a que no hay coincidencia exacta de referencia en los registros activos consultados. Una coincidencia única de identidad no se descarta por diferencias de cantidad o precio: conserva los valores del PDF y señala por separado cantidad pedida/recibida/facturada/pendiente y precios/descuentos de Odoo. Si varias líneas Odoo siguen siendo posibles, deja la asociación como ambigua.", "No inventar asociaciones de productos o pedidos ni agrupar líneas repetidas: conserva una línea por aparición del PDF hasta que el operador confirme su pedido de origen.", "Separa descuentos sucesivos tal como constan en el PDF: discount es el comercial (p. ej. 45), discountExtra el adicional (p. ej. 5), promptPaymentDiscount el pronto pago (p. ej. 2). No los sumes ni los inventes; si son globales y afectan a todas las líneas, repítelos en cada línea afectada.", "El proveedor se coteja con evidencia del PDF: no tomes el primer NIF del texto como proveedor, pues puede pertenecer al cliente. Usa CIF/NIF explícitamente situado junto al nombre/dirección del emisor y contrástalo con supplier/VAT de los candidatos. Si nombre y NIF próximos coinciden con Odoo, informa que resuelve el conflicto heurístico; si no, pide revisión. Nunca propongas el NIF del cliente como emisor.", "Distingue coincidencia exacta, probable, ambigua y sin evidencia. No conviertas una mera coincidencia de cantidad/precio en identidad de producto. Los productos sin coincidencia sólo se pueden recomendar como Servicio/Consumible existente; no los apliques ni asignes pedidos.", "Devuelve JSON estricto, sin Markdown: {reply:string, proposal:{fields?:{supplier?:string,supplierVat?:string,country?:string,billingAddress?:string,currency?:string,invoiceNumber?:string,invoiceDate?:string,dueDate?:string,base?:number,taxes?:number,total?:number},lines?:[{description:string,reference?:string,quantity?:number,priceUnit?:number,discount?:number,discountExtra?:number,promptPaymentDiscount?:number,total?:number,productCandidateId?:number,purchaseOrderCandidateId?:number,candidateReason?:string}]}, unresolved:string[]}. Devuelve sólo valores leídos expresamente del PDF. Los IDs son candidatos para revisión, nunca identidades confirmadas."],
      documents: documentsForAgent,
      requestedBy: user.name,
    };
    const runAgent = () => new Promise<string>((resolve, reject) => {
      const child = spawn("openclaw", ["agent", "--agent", "raskibot", "--session-key", `agent:raskibot:invoice-review-v3-${docs[0].driveFileId}`, "--json", "--timeout", "120", "--message", JSON.stringify(task)], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error((stderr || `Raskibot finalizó con código ${code}`).slice(0, 500))));
    });
    const parseAgentReply = (raw: string): { reply: string; proposal: any; unresolved: string[] } => {
      const candidates = [raw, raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? ""];
      for (const candidate of candidates) {
        try {
          const parsed = JSON.parse(candidate);
          const payloadText = Array.isArray(parsed?.result?.payloads) ? parsed.result.payloads.find((item: any) => typeof item?.text === "string")?.text : null;
          const answer = typeof payloadText === "string" ? JSON.parse(payloadText) : parsed;
          const text = typeof answer?.reply === "string" ? answer.reply : typeof answer?.result?.reply === "string" ? answer.result.reply : typeof answer?.text === "string" ? answer.text : "";
          if (text) return { reply: text.slice(0, 1600), proposal: answer.proposal ?? answer.result?.proposal ?? null, unresolved: Array.isArray(answer.unresolved ?? answer.result?.unresolved) ? (answer.unresolved ?? answer.result.unresolved).map(String).slice(0, 12) : [] };
        } catch { /* respuesta no estructurada */ }
      }
      return { reply: raw.trim().slice(0, 1600) || "Raskibot no devolvió una respuesta utilizable.", proposal: null, unresolved: [] };
    };
    try {
      docs.forEach((d) => raskibotInFlight.add(d.driveFileId));
      const parsed = parseAgentReply(await runAgent());
      // Treat model IDs as untrusted suggestions. Keep only product candidates
      // proven by exact PDF reference evidence and unique, eligible explicit PO hits.
      const preparedDoc = documentsForAgent[0];
      if (parsed.proposal && Array.isArray(parsed.proposal.lines)) {
        let rejectedProducts = 0;
        let rejectedOrders = 0;
        parsed.proposal.lines = parsed.proposal.lines.map((line: any) => {
          const refs = new Set(productReferenceTokens(typeof line?.reference === "string" ? line.reference : null));
          const productId = Number(line?.productCandidateId);
          const productCandidate = Number.isInteger(productId) && productId > 0
            ? preparedDoc.catalogCandidates.find((candidate: any) => candidate.id === productId && candidate.exactRef
              && candidate.matchedReferences.some((reference: string) => refs.has(reference)))
            : null;
          if (Number.isInteger(productId) && productId > 0 && !productCandidate) rejectedProducts += 1;
          const orderId = Number(line?.purchaseOrderCandidateId);
          const orderCandidate = Number.isInteger(orderId) && orderId > 0
            ? preparedDoc.purchaseOrderCandidates.find((candidate: any) => candidate.id === orderId && candidate.explicitReference
              && candidate.invoiceEligible && !candidate.vatConflict && candidate.supplierMatched)
            : null;
          if (Number.isInteger(orderId) && orderId > 0 && !orderCandidate) rejectedOrders += 1;
          return { ...line,
            productCandidateId: productCandidate ? productId : null,
            purchaseOrderCandidateId: orderCandidate ? orderId : null,
          };
        });
        if (rejectedProducts) parsed.unresolved.push(`${rejectedProducts} sugerencia(s) de producto se descartaron porque su ID no tenía coincidencia exacta verificable con la referencia de esa línea en el PDF.`);
        if (rejectedOrders) parsed.unresolved.push(`${rejectedOrders} sugerencia(s) de pedido se descartaron porque el backend no las confirmó como referencia explícita, proveedor coincidente y pedido pendiente elegible.`);
        parsed.unresolved = [...new Set(parsed.unresolved)].slice(0, 12);
      }
      for (const doc of docs) {
        doc.reviewChat = [...(doc.reviewChat ?? []), { at: new Date().toISOString(), role: "assistant", content: [parsed.reply, ...parsed.unresolved.map((item) => `Pendiente: ${item}`)].join("\n") }].slice(-60);
        // El escaneo rellena sólo datos documentales locales; Odoo y las selecciones
        // confirmadas por el operario permanecen intactos.
        if (doc.extracted && parsed.proposal && typeof parsed.proposal === "object") {
          const fields = parsed.proposal.fields && typeof parsed.proposal.fields === "object" ? parsed.proposal.fields : {};
          const safeFields: Record<string, string | number> = {};
          for (const key of ["supplier", "supplierVat", "invoiceNumber"] as const) if (typeof fields[key] === "string" && fields[key].trim()) safeFields[key] = fields[key].trim().slice(0, 60);
          for (const key of ["country", "currency"] as const) if (typeof fields[key] === "string" && fields[key].trim()) safeFields[key] = fields[key].trim().slice(0, key === "currency" ? 3 : 20).toUpperCase();
          if (typeof fields.billingAddress === "string" && fields.billingAddress.trim()) safeFields.billingAddress = fields.billingAddress.trim().slice(0, 200);
          for (const key of ["invoiceDate", "dueDate"] as const) if (typeof fields[key] === "string") {
            const date = parseDate(fields[key]);
            if (date) safeFields[key] = date;
          }
          for (const key of ["base", "taxes", "total"] as const) if (fields[key] != null && fields[key] !== "" && Number.isFinite(Number(fields[key]))) safeFields[key] = Math.round(Number(fields[key]) * 100) / 100;
          const safeLines = Array.isArray(parsed.proposal.lines) ? parsed.proposal.lines.slice(0, 60).map((line: any) => ({
            description: String(line?.description ?? "(concepto)").slice(0, 200),
            reference: line?.reference ? String(line.reference).slice(0, 60) : null,
            quantity: line?.quantity != null && Number.isFinite(Number(line.quantity)) ? Number(line.quantity) : null,
            priceUnit: line?.priceUnit != null && Number.isFinite(Number(line.priceUnit)) ? Number(line.priceUnit) : null,
            discount: line?.discount != null && Number.isFinite(Number(line.discount)) && Number(line.discount) >= 0 && Number(line.discount) <= 100 ? Number(line.discount) : null,
            discountExtra: line?.discountExtra != null && Number.isFinite(Number(line.discountExtra)) && Number(line.discountExtra) >= 0 && Number(line.discountExtra) <= 100 ? Number(line.discountExtra) : null,
            promptPaymentDiscount: line?.promptPaymentDiscount != null && Number.isFinite(Number(line.promptPaymentDiscount)) && Number(line.promptPaymentDiscount) >= 0 && Number(line.promptPaymentDiscount) <= 100 ? Number(line.promptPaymentDiscount) : null,
            taxNames: [], total: line?.total != null && Number.isFinite(Number(line.total)) ? Number(line.total) : null, confidence: 85,
            aiProductCandidateId: Number.isInteger(Number(line?.productCandidateId)) && Number(line.productCandidateId) > 0 ? Number(line.productCandidateId) : null,
            aiPurchaseOrderCandidateId: Number.isInteger(Number(line?.purchaseOrderCandidateId)) && Number(line.purchaseOrderCandidateId) > 0 ? Number(line.purchaseOrderCandidateId) : null,
            aiCandidateReason: line?.candidateReason ? String(line.candidateReason).slice(0, 240) : null,
          })) : [];
          doc.reviewProposal = { at: new Date().toISOString(), fields: safeFields, lines: safeLines, unresolved: parsed.unresolved };
          if (!question && doc.status !== "VALIDADA" && !doc.odooDraftMoveId) {
            const hasConfirmedLines = (doc.assignedPurchaseOrderIds?.length ?? 0) > 0 || doc.extracted.lines.some((line) => Boolean(line.productId || line.sourcePurchaseOrderId));
            const protectedReview = hasConfirmedLines || Boolean(doc.confirmedOdooPartnerId);
            for (const [key, value] of Object.entries(safeFields)) {
              if (!protectedReview || doc.extracted[key as keyof typeof doc.extracted] == null || doc.extracted[key as keyof typeof doc.extracted] === "")
                (doc.extracted as any)[key] = value;
            }
            if (!hasConfirmedLines && safeLines.length) {
              doc.extracted.lines = safeLines;
              doc.pdfSourceLines = safeLines.map((line) => ({ ...line }));
              doc.pdfLinesAccepted = false;
            }
            if (hasConfirmedLines && safeLines.length) doc.extracted.lines = doc.extracted.lines.map((existing) => {
              if (!existing.productId || !existing.sourcePurchaseOrderId) return existing;
              const matches = safeLines.filter((candidate) => candidate.aiProductCandidateId === existing.productId && candidate.aiPurchaseOrderCandidateId === existing.sourcePurchaseOrderId);
              const sourceCount = doc.extracted!.lines.filter((line) => line.productId === existing.productId && line.sourcePurchaseOrderId === existing.sourcePurchaseOrderId).length;
              if (matches.length !== 1 || sourceCount !== 1) return existing;
              const discountExtra = existing.discountExtra ?? matches[0].discountExtra;
              const promptPaymentDiscount = existing.promptPaymentDiscount ?? matches[0].promptPaymentDiscount;
              if (discountExtra == null && promptPaymentDiscount == null) return existing;
              const total = discountedBase(existing.quantity ?? 0, existing.priceUnit ?? 0, existing.discount, discountExtra, promptPaymentDiscount);
              return { ...existing, discountExtra, promptPaymentDiscount, total, pdfPriceVerified: false };
            });
            doc.match = matchDocument(doc, invoiceService.getStore().invoices, buildPoIndex(poLedger.getStore()));
            doc.reviewProposal = null;
          }
        }
        doc.notes = [...(doc.notes ? [doc.notes] : []), `Análisis local de Raskibot solicitado por ${user.name}; pendiente de validación humana`].join("; ").slice(0, 400);
      }
      inboxService.save();
      sendJson(response, 200, { status: "ok", processed: docs.length, document: docs[0], message: "Datos leídos del PDF rellenados en LAB. Revisa y confirma proveedor y pedidos antes de crear un borrador." });
    } catch (e) {
      docs.forEach((d) => { d.reviewChat = [...(d.reviewChat ?? []), { at: new Date().toISOString(), role: "system", content: `Raskibot no respondió: ${e instanceof Error ? e.message.slice(0, 300) : "error desconocido"}` }].slice(-60); });
      inboxService.save();
      sendJson(response, 502, { message: e instanceof Error ? e.message : "No se pudo contactar con Raskibot" });
    } finally {
      docs.forEach((d) => raskibotInFlight.delete(d.driveFileId));
    }
  });

  server.middlewares.use("/api/odoo/supplier-invoices/inbox/raskibot-proposal/apply", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "POST").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    let body: { id?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    const doc = body.id ? inboxService.getDocument(body.id) : null;
    if (!doc?.extracted || !doc.reviewProposal) return sendJson(response, 404, { message: "No hay propuesta pendiente para esta factura" });
    if (doc.status === "VALIDADA" || doc.odooDraftMoveId) return sendJson(response, 409, { message: "Una factura validada o enviada a Odoo no admite nuevas propuestas" });
    const hasConfirmedLines = (doc.assignedPurchaseOrderIds?.length ?? 0) > 0 || doc.extracted.lines.some((line) => Boolean(line.productId || line.sourcePurchaseOrderId));
    if (hasConfirmedLines && doc.reviewProposal.lines.length) return sendJson(response, 409, { message: "Hay líneas o pedidos confirmados. Revisa la propuesta sin reemplazarlos automáticamente." });
    const proposal = doc.reviewProposal;
    const acceptedFields = { ...proposal.fields };
    if (doc.confirmedOdooPartnerId) {
      delete acceptedFields.supplier;
      delete acceptedFields.supplierVat;
    }
    Object.assign(doc.extracted, acceptedFields);
    if (proposal.lines.length) {
      doc.extracted.lines = proposal.lines;
      doc.pdfSourceLines = proposal.lines.map((line) => ({ ...line }));
      doc.pdfLinesAccepted = false;
    }
    doc.reviewProposal = null;
    doc.match = matchDocument(doc, invoiceService.getStore().invoices, buildPoIndex(poLedger.getStore()));
    doc.reviewChat = [...(doc.reviewChat ?? []), { at: new Date().toISOString(), role: "system" as const, content: `Propuesta local aceptada por ${user.name}; proveedor, pedidos y productos aún requieren confirmación explícita.` }].slice(-60);
    inboxService.save();
    sendJson(response, 200, { status: "ok", document: doc, message: "Propuesta aplicada al borrador local. Revisa los campos y confirma proveedor y pedidos." });
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
      if (d.sourcePresent === false) return false;
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
    const allOrders = enrichedOrders();
    const unbilledKpis = computeUnbilledKpis(allOrders);
    const lastPoSyncAt = poLedger.getStore().meta.lastPoSyncAt;
    const lastPoSyncMs = lastPoSyncAt ? Date.parse(lastPoSyncAt) : NaN;
    const poFreshness = { source: "local_cache", refreshedAt: lastPoSyncAt, stale: !Number.isFinite(lastPoSyncMs) || Date.now() - lastPoSyncMs > 6 * 60 * 60 * 1000, error: poLedger.getStore().meta.message };
    sendJson(response, 200, {
      mode: store.documents.length ? "live" : "empty",
      total: docs.length,
      items: docs,
      kpis: inboxService.computeKpis(unbilledKpis),
      poFreshness,
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
      poFreshness: {
        source: "local_cache",
        refreshedAt: poLedger.getStore().meta.lastPoSyncAt,
        stale: !poLedger.getStore().meta.lastPoSyncAt || Date.now() - Date.parse(poLedger.getStore().meta.lastPoSyncAt) > 6 * 60 * 60 * 1000,
        error: poLedger.getStore().meta.message,
      },
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
