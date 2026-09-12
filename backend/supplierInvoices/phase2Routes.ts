// Rutas Fase 2: bandeja documental (Drive + extraccion + cotejo) y pedidos sin facturar.
// SOLO LECTURA de Drive/Odoo. Escritura unicamente del registro documental local del LAB.
// OJO: este middleware es first-match-wins por prefijo. Las sub-rutas especificas
// (/inbox/detail, /inbox/scan, /unbilled/sync...) DEBEN registrarse ANTES que sus listas.

import { createReadStream, existsSync } from "node:fs";
import { basename } from "node:path";
import { SupplierInvoiceSyncService } from "./service.ts";
import { DocumentInboxService, matchDocument, buildPoIndex } from "./documentInbox.ts";
import { PurchaseOrdersLedger, computeBilling, filterOrders, computeUnbilledKpis } from "./unbilled.ts";

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

  // Escaneo Drive -> descarga -> extraccion -> cotejo -> store local. NUNCA escribe en Drive/Odoo.
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
    let body: { id?: string; status?: string; notes?: string } = {};
    try { body = JSON.parse(await readBody(request) || "{}"); } catch { /* body vacio */ }
    if (!body.id || !body.status) return sendJson(response, 400, { message: "Faltan id o status" });
    const allowed = ["SIN_REVISAR", "EN_REVISION", "PENDIENTE_COTEJO", "PENDIENTE_VALIDAR", "VALIDADA", "INCIDENCIA"];
    if (!allowed.includes(body.status)) return sendJson(response, 400, { message: "Estado no permitido" });
    const doc = inboxService.setStatus(body.id, body.status as any, user.name, body.notes);
    if (!doc) return sendJson(response, 404, { message: "Documento no encontrado" });
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
    const store = inboxService.getStore();
    const target = store.documents.find((d) => d.driveFileId === body.id);
    if (target) target.match = match;
    inboxService.setStatus(body.id, match && match.band === "alta" ? "PENDIENTE_VALIDAR" : "PENDIENTE_COTEJO", user.name);
    sendJson(response, 200, { status: "ok", match });
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