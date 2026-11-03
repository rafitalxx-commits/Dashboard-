// Rutas del modulo Facturas de proveedor (Fase 1, SOLO LECTURA).
// Endpoints: listado+filtros+KPIs+graficos+opciones, detalle, sincronizacion (leer Odoo)
// y exportacion CSV/XLSX/PDF(imprimible). Ningun endpoint escribe en Odoo.

import zlib from "node:zlib";
import { SupplierInvoiceSyncService, filterInvoices, sortInvoices, computeKpis, computeOptions } from "./service.ts";
import type {
  SupplierInvoiceFilters,
  SupplierInvoiceRecord,
  SupplierInvoiceSortKey,
  SupplierInvoiceDataResponse,
} from "./types.ts";
import { authenticate, getOdooConfig, readRows } from "./odooClient.ts";

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
  storePath?: string;
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

function parseFilters(url: URL): SupplierInvoiceFilters {
  const s = (k: string) => {
    const v = url.searchParams.get(k);
    return v === null || v === "" ? undefined : v;
  };
  const n = (k: string): number | undefined => {
    const v = s(k);
    if (v === undefined) return undefined;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    from: s("from"),
    to: s("to"),
    year: n("year"),
    month: n("month"),
    partnerId: n("partnerId"),
    country: s("country"),
    state: s("state"),
    paymentState: s("paymentState"),
    product: s("product"),
    purchaseOrder: s("purchaseOrder"),
    currency: s("currency"),
    fiscalPosition: s("fiscalPosition"),
    minAmount: n("minAmount"),
    maxAmount: n("maxAmount"),
    text: s("text"),
  };
}

export function registerSupplierInvoicesRoutes(server: MiddlewareServer, auth: AuthReader, deps: Deps) {
  const service = new SupplierInvoiceSyncService({ dataDir: deps.dataDir, storePath: deps.storePath });
  service.load();

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

  const buildResponse = (filters: SupplierInvoiceFilters, sortKey: SupplierInvoiceSortKey, sortDir: "asc" | "desc", page: number, pageSize: number): SupplierInvoiceDataResponse => {
    const all = service.getStore().invoices;
    const filtered = filterInvoices(all, filters);
    const sorted = sortInvoices(filtered, sortKey, sortDir);
    const { kpis, charts } = computeKpis(filtered, filters);
    const options = computeOptions(filtered);
    const offset = Math.max(0, page * pageSize);
    const items = sorted.slice(offset, offset + pageSize);
    return {
      mode: all.length ? "live" : "empty",
      total: filtered.length,
      items,
      kpis,
      charts,
      options,
      lastSyncAt: service.getStore().meta.lastSyncAt,
      odooBaseUrl: deps.env.ODOO_URL ?? null,
      filteredDateRange: { from: filters.from ?? null, to: filters.to ?? null },
    };
  };

  // ---- Subrutas con prefijo más específico: deben registrarse ANTES de la ruta principal ----

  // Detalle de una factura
  server.middlewares.use("/api/odoo/supplier-invoices/detail", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const id = Number(new URL(request.url ?? "/", "http://local").searchParams.get("id") ?? 0);
    if (!id) return sendJson(response, 400, { message: "Falta id" });
    const invoice = service.getStore().invoices.find((i) => i.id === id);
    if (!invoice) return sendJson(response, 404, { message: "Factura no encontrada" });
    return sendJson(response, 200, { ...invoice, odooBaseUrl: deps.env.ODOO_URL ?? null });
  });

  // Descarga de adjuntos existentes en Odoo. Lectura autenticada; no crea ni adjunta archivos.
  server.middlewares.use("/api/odoo/supplier-invoices/attachment", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const url = new URL(request.url ?? "/", "http://local");
    const invoiceId = Number(url.searchParams.get("invoiceId") ?? 0);
    const attachmentId = Number(url.searchParams.get("id") ?? 0);
    const invoice = service.getStore().invoices.find((item) => item.id === invoiceId);
    if (!invoice || !invoice.attachments.some((attachment) => attachment.id === attachmentId)) return sendJson(response, 404, { message: "Adjunto no disponible para esta factura" });
    try {
      const config = getOdooConfig(deps.env);
      const uid = await authenticate(config);
      const [attachment] = await readRows<any>(config, uid, "ir.attachment", [attachmentId], ["name", "mimetype", "type", "url", "datas"]);
      if (!attachment) return sendJson(response, 404, { message: "Adjunto no encontrado en Odoo" });
      if (attachment.type === "url" && attachment.url) {
        response.statusCode = 302;
        response.setHeader("Location", attachment.url);
        response.end();
        return;
      }
      if (!attachment.datas) return sendJson(response, 404, { message: "El adjunto no contiene un archivo descargable" });
      response.statusCode = 200;
      response.setHeader("Content-Type", attachment.mimetype || "application/octet-stream");
      response.setHeader("Content-Disposition", `inline; filename="${String(attachment.name || "adjunto").replace(/[\r\n"]/g, "_")}"`);
      response.end(Buffer.from(attachment.datas, "base64"));
    } catch (error) {
      sendJson(response, 500, { message: error instanceof Error ? error.message : "No se pudo abrir el adjunto" });
    }
  });

  // Exportacion CSV / XLSX / PDF (respeta filtros activos)
  server.middlewares.use("/api/odoo/supplier-invoices/export", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const url = new URL(request.url ?? "/", "http://local");
    const format = url.searchParams.get("format") ?? "csv";
    const all = service.getStore().invoices;
    const filtered = filterInvoices(all, parseFilters(url));
    const sorted = sortInvoices(filtered, (url.searchParams.get("sortKey") as SupplierInvoiceSortKey) ?? "invoiceDate", (url.searchParams.get("sortDir") as "asc" | "desc") ?? "desc");
    if (format === "xlsx") return exportXlsx(response, sorted);
    if (format === "pdf") return exportPdf(response, sorted, url.searchParams.get("title") ?? undefined);
    return exportCsv(response, sorted);
  });

  // Sincronizacion: lee Odoo y actualiza la cache del Dashboard (nunca escribe en Odoo)
  server.middlewares.use("/api/odoo/supplier-invoices/sync", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    if ((request.method ?? "GET").toUpperCase() !== "POST") return sendJson(response, 405, { message: "Usa POST" });
    try {
      const incremental = (new URL(request.url ?? "/", "http://local").searchParams.get("incremental") ?? "true") !== "false";
      const meta = await service.syncFromOdoo(deps.env, { incremental });
      sendJson(response, 200, { status: "ok", meta });
    } catch (error) {
      sendJson(response, 500, { status: "error", message: error instanceof Error ? error.message : "Error sincronizando" });
    }
  });

  // Estado/estadisticas del store
  server.middlewares.use("/api/odoo/supplier-invoices/meta", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    sendJson(response, 200, service.getStore().meta);
  });

  // ---- Ruta principal (lista + filtros + KPIs + graficos + opciones + pagina) ----
  server.middlewares.use("/api/odoo/supplier-invoices", async (request: any, response: any) => {
    const user = requireUser(request, response);
    if (!user) return;
    const url = new URL(request.url ?? "/", "http://local");
    const filters = parseFilters(url);
    const sortKey = (url.searchParams.get("sortKey") as SupplierInvoiceSortKey) ?? "invoiceDate";
    const sortDir = (url.searchParams.get("sortDir") as "asc" | "desc") ?? "desc";
    const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? 25) || 25));
    try {
      sendJson(response, 200, buildResponse(filters, sortKey, sortDir, page, pageSize));
    } catch (error) {
      sendJson(response, 500, {
        mode: "empty",
        total: 0,
        items: [],
        kpis: null,
        charts: null,
        options: null,
        lastSyncAt: service.getStore().meta.lastSyncAt,
        filteredDateRange: { from: filters.from ?? null, to: filters.to ?? null },
        message: error instanceof Error ? error.message : "Error leyendo facturas de proveedor",
      });
    }
  });
}

// ---------- Exportaciones ----------

const EXPORT_COLUMNS: { key: keyof SupplierInvoiceRecord | "total", label: string }[] = [
  { key: "ref", label: "Factura proveedor" },
  { key: "name", label: "Interno Odoo" },
  { key: "partnerName", label: "Proveedor" },
  { key: "partnerVat", label: "NIF/VAT" },
  { key: "partnerCountry", label: "País" },
  { key: "invoiceDate", label: "Fecha factura" },
  { key: "accountingDate", label: "Fecha contable" },
  { key: "dueDate", label: "Vencimiento" },
  { key: "state", label: "Estado" },
  { key: "paymentState", label: "Pago" },
  { key: "currency", label: "Moneda" },
  { key: "amountUntaxed", label: "Base" },
  { key: "amountTax", label: "Impuestos" },
  { key: "amountTotal", label: "Total" },
  { key: "amountResidual", label: "Pendiente" },
  { key: "amountPaid", label: "Pagado" },
  { key: "invoiceOrigin", label: "Referencia" },
  { key: "linkedPurchaseOrderNames", label: "Pedido compra" },
  { key: "linkedPickingNames", label: "Recepciones" },
];

function cellValue(row: SupplierInvoiceRecord, key: (typeof EXPORT_COLUMNS)[number]["key"]): string {
  const v = row[key];
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return v == null ? "" : String(v);
}

function exportCsv(response: any, rows: SupplierInvoiceRecord[]): void {
  const header = EXPORT_COLUMNS.map((c) => `"${c.label.replace(/"/g, '""')}"`).join(";");
  const body = rows.map((r) => EXPORT_COLUMNS.map((c) => `"${cellValue(r, c.key).replace(/"/g, '""')}"`).join(";")).join("\n");
  const content = "\uFEFF" + header + "\n" + body + "\n";
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", 'attachment; filename="facturas-proveedor.csv"');
  response.end(content);
}

// XLSX minimo (hoja simple) sin dependencias externas.
function xlsxSheetXml(rows: SupplierInvoiceRecord[]): string {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const colRefs = EXPORT_COLUMNS.map((_, i) => String.fromCharCode(65 + i)).join("");
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`;
  const headerRow = EXPORT_COLUMNS.map((c) => `<c t="inlineStr"><is><t>${esc(c.label)}</t></is></c>`).join("");
  xml += `<row r="1">${headerRow}</row>`;
  rows.forEach((r, i) => {
    const cells = EXPORT_COLUMNS.map((c) => `<c t="inlineStr"><is><t>${esc(cellValue(r, c.key))}</t></is></c>`).join("");
    xml += `<row r="${i + 2}">${cells}</row>`;
  });
  xml += `</sheetData></worksheet>`;
  return xml;
}

function zipStore(files: Record<string, string>): Buffer {
  // ZIP sin compresion (metodo 0) para minimizar riesgo de implementacion.
  const chunks: Buffer[] = [];
  let offset = 0;
  const central: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    const dataBuf = Buffer.from(content, "utf8");
    const crc = crc32(dataBuf);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, dataBuf);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, nameBuf, Buffer.alloc(0));
    offset += local.length + nameBuf.length + dataBuf.length;
  }
  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...central, eocd]);
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function exportXlsx(response: any, rows: SupplierInvoiceRecord[]): void {
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Facturas" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": xlsxSheetXml(rows),
  };
  const zip = zipStore(files);
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  response.setHeader("Content-Disposition", 'attachment; filename="facturas-proveedor.xlsx"');
  response.end(zip);
}

function exportPdf(response: any, rows: SupplierInvoiceRecord[], title?: string): void {
  const pageRows = 34;
  const pages = Array.from({ length: Math.max(1, Math.ceil(rows.length / pageRows)) }, (_, page) => rows.slice(page * pageRows, (page + 1) * pageRows));
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pageIds: number[] = [];
  for (const page of pages) {
    const text = [
      title ?? "Facturas de proveedor",
      `Documentos exportados: ${rows.length}`,
      "Proveedor | Factura proveedor | Interno Odoo | Fecha | Total | Pendiente | Pedido compra",
      ...page.map((r) => `${r.partnerName} | ${r.ref ?? ""} | ${r.name} | ${r.invoiceDate ?? ""} | ${r.amountTotal.toFixed(2)} ${r.currency ?? "EUR"} | ${r.amountResidual.toFixed(2)} | ${r.linkedPurchaseOrderNames.join(", ")}`),
    ];
    const stream = ["BT", "/F1 9 Tf", "50 795 Td", ...text.map((line, index) => `${index ? "0 -20 Td" : ""} (${escapePdf(line).slice(0, 155)}) Tj`), "ET"].join("\n");
    const contentId = objects.length + 1;
    const pageId = objects.length + 2;
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, "latin1")); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", 'attachment; filename="facturas-proveedor.pdf"');
  response.end(Buffer.from(pdf, "latin1"));
}

function escapePdf(v: string): string {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, "?");
}

function exportPdfHtml(response: any, rows: SupplierInvoiceRecord[], title?: string): void {
  const rowsHtml = rows.slice(0, 1000).map((r) => `<tr>
    <td>${""}</td>
    <td>${escapeHtml(r.ref ?? "")}</td>
    <td>${escapeHtml(r.name)}</td>
    <td>${escapeHtml(r.partnerName)}</td>
    <td>${escapeHtml(r.invoiceDate ?? "")}</td>
    <td>${escapeHtml(r.state)}</td>
    <td>${escapeHtml(r.paymentState)}</td>
    <td>${escapeHtml(r.currency ?? "")}</td>
    <td class="num">${r.amountTotal.toFixed(2)}</td>
    <td class="num">${r.amountResidual.toFixed(2)}</td>
  </tr>`).join("\n");
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title ?? "Facturas de proveedor")}</title>
<style>
 body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#1f2937;margin:24px}
 h1{font-size:18px;color:#1f2937} .sub{color:#6c757d;margin-bottom:16px}
 table{border-collapse:collapse;width:100%;font-size:10px}
 th,td{border:1px solid #d1d5db;padding:4px 6px;text-align:left;white-space:nowrap}
 th{background:#1f2937;color:#fff} td.num{text-align:right}
 @media print{ tr{page-break-inside:avoid} }
</style></head><body>
<h1>Facturas de proveedor</h1><div class="sub">${rows.length} facturas · generado el ${new Date().toLocaleString("es-ES")} · fuente: Odoo</div>
<table><thead><tr><th>#</th><th>Factura proveedor</th><th>Interno Odoo</th><th>Proveedor</th><th>Fecha</th><th>Estado</th><th>Pago</th><th>Moneda</th><th>Total</th><th>Pendiente</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>
<script>window.onload=function(){window.print();}</script></body></html>`;
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Content-Disposition", 'attachment; filename="facturas-proveedor-imprimible.html"');
  response.end(html);
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Evitar warning de import no usado en algunos setups TS.
void zlib;
