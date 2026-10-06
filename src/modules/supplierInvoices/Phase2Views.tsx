// Fase 2 · Bandeja documental y Pedidos sin facturar — sub-vistas de Facturas de proveedor.
// Se integra en SupplierInvoicesView mediante tabs. UI con feedback de carga en cada acción.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Filter,
  Folder,
  Inbox,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { CatalogProduct } from "../../services/odooTypes";
import { WEB_ADJUSTMENT_LOCAL_SENTINEL, isWebAdjustmentProductId, calculateWebAdjustment, discountedBase, taxFromBase } from "../../../shared/supplierInvoiceDiscounts";

async function readSaveResponse(response: Response): Promise<Record<string, any>> {
  const body = await response.text();
  if (!body.trim()) throw new Error(`El servidor no respondió al guardar (HTTP ${response.status}). Comprueba que LAB esté disponible y vuelve a intentarlo.`);
  try { return JSON.parse(body) as Record<string, any>; }
  catch { throw new Error(`El servidor devolvió una respuesta no válida al guardar (HTTP ${response.status}). No se ha confirmado el guardado.`); }
}

type F = Record<string, string>;

type DocLine = {
  productId?: number | null;
  description: string;
  reference: string | null;
  quantity: number | null;
  priceUnit: number | null;
  discount: number | null;
  discountExtra?: number | null;
  promptPaymentDiscount?: number | null;
  taxNames: string[];
  taxId?: number | null;
  taxRate?: number | null;
  taxAmount?: number | null;
  totalWithTax?: number | null;
  accountId?: number | null;
  accountName?: string | null;
  sourcePurchaseOrderId?: number | null;
  sourcePurchaseOrderName?: string | null;
  qtyOrdered?: number | null;
  qtyReceived?: number | null;
  qtyInvoiced?: number | null;
  qtyPending?: number | null;
  aiProductCandidateId?: number | null;
  aiPurchaseOrderCandidateId?: number | null;
  aiCandidateReason?: string | null;
  matchCandidates?: Array<{ purchaseOrderId: number; purchaseOrderName: string; purchaseLineId: number | null; productId: number; productName: string; score: number; identityLevel: "exact" | "probable" | "ambiguous"; evidence: string[]; discrepancies: string[] }>;
  total: number | null;
  confidence: number;
};

type Extracted = {
  supplier: string | null;
  supplierVat: string | null;
  country: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  base: number | null;
  taxes: number | null;
  total: number | null;
  lines: DocLine[];
  textPreview: string;
  needsOcr: boolean;
  warnings: string[];
  pdfPages: number;
  billingAddress: string | null;
  docType: string | null;
};

type MatchCriterion = { key: string; label: string; ok: boolean; detail: string };
type Match = {
  purchaseOrderId: number | null;
  purchaseOrderName: string | null;
  score: number;
  band: "alta" | "media" | "baja" | "sin";
  criteria: MatchCriterion[];
  totalDiff: number | null;
  invoiceIdOdoo: number | null;
  invoiceNameOdoo: string | null;
  excluded?: boolean;
  excludedReason?: string | null;
};

type Doc = {
  driveFileId: string;
  confirmedOdooPartnerId?: number | null;
  invoiceBranch?: "goods" | "services" | null;
  pdfLinesAccepted?: boolean;
  name: string;
  size: number | null;
  modifiedTime: string | null;
  webViewLink: string | null;
  source: string;
  sourceEmail: string | null;
  detectedAt: string | null;
  extracted: Extracted | null;
  ocrStatus: string;
  aiStatus: string;
  confidence: number | null;
  match: Match | null;
  status: string;
  validationUser: string | null;
  validationAt: string | null;
  notes: string | null;
  assignedPurchaseOrderIds: number[] | null;
  pdfSourceLines?: DocLine[];
  reviewChat?: { at: string; role: "user" | "assistant" | "system"; content: string }[];
  reviewProposal?: { at: string; fields: Partial<Extracted>; lines: DocLine[]; unresolved: string[] } | null;
  odooDraftMoveId: number | null;
  odooDraftName: string | null;
  odooDraftState: string | null;
  odooDraftActual?: { reference?: string; dueDate?: string | null; base: number; taxes: number; total: number; lines: { productId: number | null; purchaseLineId: number | null; quantity: number; priceUnit: number; base: number; total: number }[] } | null;
  movedTo?: string | null;
  targetFolderPath?: string | null;
  pdfCached: boolean;
};

type InboxData = {
  mode: "live" | "empty";
  total: number;
  items: Doc[];
  kpis: {
    sinRevisar: number;
    pendientesCotejo: number;
    pedidosSinFacturar: number;
    importePedidosSinFacturar: number;
    importePendienteCotejo: number;
    sinCoincidenciaOdoo: number;
    facturacionParcial: number;
    validadasMes: number;
    incidencias: number;
    borradoresListosOdoo: number;
  };
  lastScanAt: string | null;
  poFreshness?: { source: "live_odoo" | "local_cache"; refreshedAt: string | null; stale: boolean; error: string | null };
};

type PoLine = {
  id?: number | null;
  productId: number | null;
  productName: string | null;
  qtyOrdered: number;
  qtyReceived: number;
  qtyInvoiced: number;
  qtyPending: number;
  priceUnit: number;
  subtotal: number;
};

type Order = {
  id: number;
  name: string;
  state: string;
  partnerName: string;
  partnerCountry: string | null;
  currency: string | null;
  dateOrder: string | null;
  buyer: string | null;
  origin: string | null;
  supplierRef?: string | null;
  amountTotal: number;
  pickings: { name: string; state: string; dateDone: string | null }[];
  allReceived: boolean;
  lastReceptionAt: string | null;
  daysSinceReception: number | null;
  linkedInvoiceNames: string[];
  billedAmount: number;
  pendingAmount: number;
  billedPct: number | null;
  billingSplit: boolean;
  lines: PoLine[];
  status: string;
};

type UnbilledData = {
  mode: "live" | "empty";
  total: number;
  items: Order[];
  kpis: {
    ordersWithoutInvoice: { count: number; total: number };
    partialBilling: { count: number; total: number; pending: number };
    receivedOver15Days: { count: number };
    importaciones: { count: number; total: number };
    totalPendingAmount: number;
    totalOrders: number;
  };
  lastPoSyncAt: string | null;
  poFreshness?: { source: "local_cache"; refreshedAt: string | null; stale: boolean; error: string | null };
};

const money = (v: number, c = "EUR") => {
  const raw = typeof c === "string" ? c.trim() : "";
  const symbols: Record<string, string> = { "€": "EUR", "$": "USD", "£": "GBP", "¥": "JPY" };
  const currency = symbols[raw] ?? (raw || "EUR").toUpperCase();
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(v || 0);
  } catch {
    // Un símbolo u otro valor de extracción no es un ISO-4217 currency code.
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v || 0);
  }
};
const dt = (v: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  // Fechas extraidas por heuristica pueden ser invalidas: nunca tumbar el render.
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES").format(d);
};

const STATUS_ES: Record<string, string> = {
  SIN_REVISAR: "Sin revisar",
  EN_REVISION: "En revisión",
  PENDIENTE_COTEJO: "Pendiente de cotejo",
  PENDIENTE_VALIDAR: "Pendiente de validar",
  VALIDADA: "Validada",
  INCIDENCIA: "Incidencia",
};
const PO_STATUS_ES: Record<string, string> = {
  SIN_FACTURA: "Sin factura",
  FACTURACION_PARCIAL: "Facturación parcial",
  FACTURADO: "Facturado",
  SIN_RECEPCION: "Sin recepción",
  INCIDENCIA: "Incidencia",
};
const BAND_ES: Record<string, string> = {
  alta: "Coincidencia alta",
  media: "Coincidencia media",
  baja: "Coincidencia baja",
  sin: "Sin coincidencia",
};

function normalizeSearch(value: unknown) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es"); }

const DOC_TYPE_ES: Record<string, string> = {
  factura: "Factura",
  albaran: "Albarán",
  aduana: "Aduana",
  transporte: "Transporte",
  otro: "Otro",
};

export function InboxView({ base }: { base: string }) {
  const api = (s: string) => base + s;
  const [data, setData] = useState<InboxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const initialScanStarted = useRef(false);
  const [extracting, setExtracting] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState<Doc | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [draft, setDraft] = useState<F>({ status: "", source: "", partner: "", matchBand: "", text: "" });
  const [filters, setFilters] = useState<F>({ status: "", source: "", partner: "", matchBand: "", text: "" });

  const qs = useMemo(() => {
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
    q.set("pageSize", "50");
    return q.toString();
  }, [filters]);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(api(`/api/odoo/supplier-invoices/inbox?${qs}`));
      const x = await r.json();
      if (!r.ok) throw Error(x.message);
      setData(x);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error leyendo bandeja");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [qs]);

  const scan = async () => {
    setScanning(true);
    setMsg("");
    try {
      const r = await fetch(api("/api/odoo/supplier-invoices/inbox/scan"), { method: "POST" });
      const x = await r.json();
      if (!r.ok) throw Error(x.message);
      setMsg(`Lista de Drive actualizada: ${x.scanned} PDF, ${x.added} nuevos. Ningún documento analizado.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error actualizando la lista de Drive");
    } finally {
      setScanning(false);
    }
  };
  // La bandeja se sincroniza al abrirse; esto sólo lee nombres/metadatos de Drive.
  useEffect(() => {
    if (initialScanStarted.current) return;
    initialScanStarted.current = true;
    void scan();
  }, []);

  const extract = async (ids?: string[]) => {
    if (!ids?.length) return;
    setExtracting(ids?.length ? ids[0] : "batch");
    setMsg("");
    try {
      const r = await fetch(api("/api/odoo/supplier-invoices/inbox/raskibot-extract"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const x = await r.json();
      if (!r.ok) throw Error(x.message);
      setMsg(x.message || "Análisis añadido al chat local de la factura. Abre la factura para revisar y responder a Raskibot.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error en extracción IA");
    } finally {
      setExtracting(null);
    }
  };

  const setStatus = async (driveFileId: string, status: string) => {
    setActing(driveFileId + status);
    try {
      const r = await fetch(api("/api/odoo/supplier-invoices/inbox/status"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: driveFileId, status }),
      });
      const x = await r.json();
      if (!r.ok) throw Error(x.message);
      setSelected(x.document);
      setMsg(STATUS_ES[status] ? `Documento marcado como «${STATUS_ES[status]}»` : "Estado actualizado");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error actualizando estado");
    } finally {
      setActing(null);
    }
  };

  if (!data && loading)
    return (
      <section className="si-loading">
        <RefreshCw className="spin" /> Cargando bandeja documental…
      </section>
    );

  const k = data?.kpis;
  const kpiCards = [
    { label: "Facturas sin revisar", value: k?.sinRevisar ?? 0, detail: "en Drive SIN REVISAR", action: "Ver documentos", tone: "danger" },
    { label: "Pendientes de cotejo", value: k?.pendientesCotejo ?? 0, detail: money(k?.importePendienteCotejo ?? 0), tone: "warn" },
    { label: "Pedidos sin facturar", value: k?.pedidosSinFacturar ?? 0, detail: money(k?.importePedidosSinFacturar ?? 0) + (data?.poFreshness?.stale ? " · DATOS DESACTUALIZADOS" : data?.poFreshness?.refreshedAt ? " · Odoo actualizado" : " · sin lectura actual"), tone: "warn" },
    { label: "Sin coincidencia Odoo", value: k?.sinCoincidenciaOdoo ?? 0, detail: "sin pedido candidato", tone: "" },
    { label: "Facturación parcial", value: k?.facturacionParcial ?? 0, detail: "pedidos parcialmente facturados", tone: "" },
    { label: "Validadas este mes", value: k?.validadasMes ?? 0, detail: `${k?.borradoresListosOdoo ?? 0} listas para Odoo`, tone: "ok" },
  ];

  return (
    <section className="si-phase2">
      <header className="si-head">
        <div>
          <p className="eyebrow">Compras / Facturas de proveedor</p>
          <h2>Bandeja documental</h2>
          <p>Fase 2 · Bandeja documental · {data?.total ?? 0} PDF en la lista · IA sólo por documento elegido</p>
        </div>
        <div className="si-actions">
          <small>Último escaneo: {dt(data?.lastScanAt?.slice(0, 10) ?? null)}</small>
          <button className="si-primary" disabled={scanning || extracting !== null} onClick={() => void scan()}>
            {scanning ? <RefreshCw className="spin" /> : <Inbox />}
            {scanning ? "Actualizando lista…" : "Actualizar lista de Drive"}
          </button>
        </div>
      </header>
      {msg && <p className="si-msg" role="status">{msg}</p>}

      <section className="si-kpis">
        {kpiCards.map((c) => (
          <article key={c.label} className={c.tone ? `kpi-${c.tone}` : ""}>
            <span>{c.label}</span>
            <strong>{c.value}</strong>
            <small>{c.detail}{c.action ? ` · ${c.action}` : ""}</small>
          </article>
        ))}
      </section>

      <section className="si-flow">
        <span>Drive SIN REVISAR</span> <ArrowRight />
        <span>Descarga PDF</span> <ArrowRight />
        <span>Extracción de datos</span> <ArrowRight />
        <span>Cotejo con Odoo</span> <ArrowRight />
        <span>Decisión humana</span>
      </section>

      <section className="si-filters">
        <div className="si-filter-title"><Filter /> <b>Filtros</b></div>
        <div className="si-filter-grid">
          {([["status", "Estado", Object.keys(STATUS_ES), Object.values(STATUS_ES)],
             ["source", "Origen", ["email", "manual", "web"], ["Email", "Manual", "Web"]],
             ["matchBand", "Coincidencia", ["alta", "media", "baja", "sin"], Object.values(BAND_ES)]] as const).map(([key, label, values, names]) => (
            <label key={key} className="si-field">
              <span>{label}</span>
              <select value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}>
                <option value="">Todos</option>
                {values.map((v, i) => <option key={v} value={v}>{names[i]}</option>)}
              </select>
            </label>
          ))}
          <label className="si-field">
            <span>Proveedor</span>
            <input value={draft.partner} onChange={(e) => setDraft({ ...draft, partner: e.target.value })} placeholder="Nombre detectado…" />
          </label>
          <label className="si-search">
            <span>Buscar</span>
            <Search size={15} />
            <input value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="Archivo, proveedor, nº factura, pedido…" />
          </label>
          <div className="si-filter-buttons">
            <button className="si-primary" onClick={() => { setFilters(draft); }}>Aplicar</button>
            <button onClick={() => { setDraft({ status: "", source: "", partner: "", matchBand: "", text: "" }); setFilters({ status: "", source: "", partner: "", matchBand: "", text: "" }); }}>Limpiar</button>
          </div>
        </div>
      </section>

      <div className="si-table si-table-docs">
        <table>
          <thead>
            <tr>
              <th>Archivo</th><th>Proveedor detectado</th><th>Nº factura</th><th>Fecha</th>
              <th>Importe</th><th>Pedido Odoo</th><th>Coincidencia</th><th>Estado</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9}>Actualizando…</td></tr>
            ) : !data?.items.length ? (
              <tr><td colSpan={9}>No hay documentos. Pulsa «Actualizar lista de Drive» para ver los PDF de SIN REVISAR.</td></tr>
            ) : (
              data.items.map((doc) => (
                <tr key={doc.driveFileId} onClick={() => setSelected(doc)}>
                  <td><b>{doc.name}</b></td>
                  <td>{doc.extracted?.supplier || "—"}<small>{doc.extracted?.supplierVat || ""}</small></td>
                  <td>{doc.extracted?.invoiceNumber || "—"}</td>
                  <td>{dt(doc.extracted?.invoiceDate ?? null)}</td>
                  <td>{doc.extracted?.total != null ? money(doc.extracted.total, doc.extracted.currency ?? "EUR") : "—"}</td>
                  <td>{doc.match?.purchaseOrderName || "—"}</td>
                  <td>
                    {doc.match?.excluded ? (
                      <span className="si-badge si-doc-type-badge no-factura">No factura · {DOC_TYPE_ES[doc.extracted?.docType ?? ""] ?? doc.extracted?.docType}</span>
                    ) : doc.match ? (
                      <span className={`si-match si-match-${doc.match.band}`}>{Math.min(100, doc.match.score)}% · {BAND_ES[doc.match.band]}</span>
                    ) : doc.extracted?.needsOcr ? (
                      <span className="si-match si-match-sin">OCR pendiente</span>
                    ) : "—"}
                  </td>
                  <td><span className={`si-badge doc-${doc.status}`}>{STATUS_ES[doc.status] ?? doc.status}</span></td>
                  <td className="si-actions-cell">
                    <button type="button" disabled={extracting !== null || scanning} onClick={(e) => { e.stopPropagation(); void extract([doc.driveFileId]); }}>
                      {extracting === doc.driveFileId ? <RefreshCw className="spin" size={15} /> : <Sparkles size={15} />}
                      {extracting === doc.driveFileId ? "Analizando…" : "Escanear con IA"}
                    </button>
                    {doc.webViewLink && <a href={doc.webViewLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Ver PDF en Drive"><ExternalLink size={15} /></a>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="si-inbox-mobile" aria-label="Facturas de la bandeja documental">
        {loading ? <p role="status">Actualizando facturas…</p> : !data?.items.length ? (
          <p>No hay documentos. Pulsa «Actualizar lista de Drive» para ver los PDF de SIN REVISAR.</p>
        ) : data.items.map((doc) => (
          <button className="si-inbox-card" type="button" key={doc.driveFileId} onClick={() => setSelected(doc)}>
            <strong>{doc.name}</strong>
            <span>{doc.extracted?.supplier || "Proveedor pendiente"} · {doc.extracted?.invoiceNumber || "Nº pendiente"}</span>
            <span>{dt(doc.extracted?.invoiceDate ?? null)} · {doc.extracted?.total != null ? money(doc.extracted.total, doc.extracted.currency ?? "EUR") : "Importe pendiente"}</span>
            <span>Pedido: {doc.match?.purchaseOrderName || "sin confirmar"} · {doc.match?.excluded ? "No factura" : doc.match ? `${Math.min(100, doc.match.score)}% ${BAND_ES[doc.match.band]}` : "sin cotejar"}</span>
            <span className={`si-badge doc-${doc.status}`}>{STATUS_ES[doc.status] ?? doc.status}</span>
            <small>Abrir PDF y revisión con Raskibot</small>
          </button>
        ))}
      </div>

      {selected && (
        <DocDetail
          doc={selected}
          close={() => setSelected(null)}
          extracting={extracting}
          onAiExtract={(id) => void extract([id])}
          onDocUpdated={(d) => setSelected(d)}
          base={base}
        />
      )}
    </section>
  );
}

type PoCandidate = {
  id: number;
  name: string;
  origin: string | null;
  supplierRef?: string | null;
  dateOrder: string | null;
  amountTotal: number;
  currency: string | null;
  state: string;
  invoiceStatus?: string | null;
  billedAmount: number;
  billedPct: number;
  pendingAmount: number;
  allReceived: boolean;
  lastReceptionAt: string | null;
  lines: { productId: number | null; productName: string | null; qtyOrdered: number; qtyReceived: number; qtyInvoiced: number; qtyPending: number; priceUnit: number; discount: number; subtotal: number; taxIds: number[] }[];
};

type ProductLineEdit = {
  productId?: number | null;
  description: string;
  reference: string | null;
  quantity: number | null;
  priceUnit: number | null;
  discount: number | null;
  discountExtra?: number | null;
  promptPaymentDiscount?: number | null;
  taxNames: string[];
  taxId?: number | null;
  taxRate?: number | null;
  taxAmount?: number | null;
  totalWithTax?: number | null;
  accountId?: number | null;
  accountName?: string | null;
  total: number | null;
  sourcePurchaseOrderName?: string | null;
  sourcePurchaseOrderId?: number | null;
  genericProductConfirmed?: boolean;
  pdfPriceVerified?: boolean;
  qtyOrdered?: number | null;
  qtyReceived?: number | null;
  qtyInvoiced?: number | null;
  qtyPending?: number | null;
  aiProductCandidateId?: number | null;
  aiPurchaseOrderCandidateId?: number | null;
  aiCandidateReason?: string | null;
  matchCandidates?: DocLine["matchCandidates"];
};

function recalculateProductLine(line: ProductLineEdit, patch: Partial<ProductLineEdit>): ProductLineEdit {
  const next = { ...line, ...patch };
  const baseInputsChanged = ["quantity", "priceUnit", "discount", "discountExtra", "promptPaymentDiscount"].some((key) => key in patch);
  if (baseInputsChanged) next.pdfPriceVerified = false;
  if (next.quantity != null && next.priceUnit != null && patch.total === undefined && baseInputsChanged) {
    next.total = discountedBase(next.quantity, next.priceUnit, next.discount, next.discountExtra, next.promptPaymentDiscount);
  }
  if ((baseInputsChanged || patch.taxId !== undefined || patch.total !== undefined) && patch.taxAmount === undefined) {
    next.taxAmount = next.taxId && next.taxRate != null && next.total != null ? taxFromBase(next.total, next.taxRate) : null;
  }
  if (patch.totalWithTax === undefined && (baseInputsChanged || patch.taxId !== undefined || patch.total !== undefined || patch.taxAmount !== undefined)) {
    next.totalWithTax = next.total != null ? Math.round((next.total + (next.taxAmount ?? 0)) * 100) / 100 : null;
  }
  return next;
}

const invoiceLineColumns = [
  { id: "product", label: "Producto", width: 230, min: 150 },
  { id: "quantity", label: "Cant.", width: 58, min: 50 },
  { id: "price", label: "Precio Uds", width: 82, min: 70 },
  { id: "discount", label: "DTO", width: 66, min: 55 },
  { id: "discountExtra", label: "DTO extra", width: 75, min: 65 },
  { id: "promptPaymentDiscount", label: "Pronto pago", width: 86, min: 75 },
  { id: "tax", label: "IVA", width: 132, min: 100 },
  { id: "taxAmount", label: "Imp.", width: 72, min: 65 },
  { id: "account", label: "Cuenta", width: 140, min: 100 },
  { id: "base", label: "Sin IVA", width: 84, min: 75 },
  { id: "total", label: "Con IVA", width: 88, min: 75 },
  { id: "remove", label: "", width: 30, min: 30 },
] as const;

type SupplierSuggestion = { id: number; name: string; vat: string | null; country: string | null; billingAddress: string | null };
type PickerProduct = Pick<CatalogProduct, "id" | "name" | "reference" | "barcode" | "type">;
type ProductMappingSuggestion = { productId: number; concept: string; reference: string | null; updatedAt: string; updatedBy: string; sourceDocumentId: string } | null;
type TaxOption = { id: number; name: string; rate: number; type: string };
type AccountOption = { id: number; code: string; name: string; type: string };
function DocDetail({ doc, close, extracting, onAiExtract, onDocUpdated, base }: { doc: Doc; close: () => void; extracting: string | null; onAiExtract: (id: string) => void; onDocUpdated: (doc: Doc) => void; base?: string }) {
  const ex = doc.extracted;
  const api = (s: string) => (base ?? "") + s;
  const [lines, setLines] = useState<ProductLineEdit[]>(() => (doc.extracted?.lines ?? []).map((l) => ({ ...l })));
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkingLineIndex, setLinkingLineIndex] = useState<number | null>(null);
  const [term, setTerm] = useState("");
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [taxOptions, setTaxOptions] = useState<TaxOption[]>([]);
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
  const [bulkTaxId, setBulkTaxId] = useState<number | null>(null);
  const [bulkExtraDiscount, setBulkExtraDiscount] = useState("");
  const [bulkPromptDiscount, setBulkPromptDiscount] = useState("");
  const [bulkAccountId, setBulkAccountId] = useState<number | null>(null);
  const [optionError, setOptionError] = useState("");
  const [lineColumnWidths, setLineColumnWidths] = useState<Record<string, number>>(
    () => Object.fromEntries(invoiceLineColumns.map((column) => [column.id, column.width])),
  );
  const lineGridTemplate = invoiceLineColumns.map((column) => `${lineColumnWidths[column.id] ?? column.width}px`).join(" ");
  const startLineColumnResize = (event: ReactPointerEvent<HTMLButtonElement>, columnId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const column = invoiceLineColumns.find((item) => item.id === columnId);
    if (!column || column.id === "remove") return;
    const startX = event.clientX;
    const startWidth = lineColumnWidths[columnId] ?? column.width;
    const onPointerMove = (moveEvent: PointerEvent) => {
      setLineColumnWidths((current) => ({ ...current, [columnId]: Math.max(column.min, startWidth + moveEvent.clientX - startX) }));
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };
  const [splitPct, setSplitPct] = useState(() => Number(localStorage.getItem("supplier-invoice-pdf-width")) || 50);
  const draggingSplit = useRef(false);
  // Campos extraidos editables + memoria de proveedor
  const [fields, setFields] = useState(() => ({
    supplier: doc.extracted?.supplier ?? "",
    supplierVat: doc.extracted?.supplierVat ?? "",
    country: doc.extracted?.country ?? "",
    invoiceNumber: doc.extracted?.invoiceNumber ?? "",
    invoiceDate: doc.extracted?.invoiceDate ?? "",
    dueDate: doc.extracted?.dueDate ?? "",
    currency: doc.extracted?.currency ?? "",
    billingAddress: doc.extracted?.billingAddress ?? "",
    base: doc.extracted?.base != null ? String(doc.extracted.base) : "",
    taxes: doc.extracted?.taxes != null ? String(doc.extracted.taxes) : "",
    total: doc.extracted?.total != null ? String(doc.extracted.total) : "",
    docType: doc.extracted?.docType ?? "",
  }));
  const [savingFields, setSavingFields] = useState(false);
  const [fieldsMsg, setFieldsMsg] = useState("");
  const [taxTotalEdit, setTaxTotalEdit] = useState<string | null>(null);
  const [manualTaxTotal, setManualTaxTotal] = useState(false);
  const [supplierSuggestions, setSupplierSuggestions] = useState<SupplierSuggestion[]>([]);
  const [supplierSuggestionsLoading, setSupplierSuggestionsLoading] = useState(false);
  const [supplierAccepted, setSupplierAccepted] = useState(Boolean(doc.confirmedOdooPartnerId));
  const [confirmedPartnerId, setConfirmedPartnerId] = useState<number | null>(doc.confirmedOdooPartnerId ?? null);
  const [invoiceBranch, setInvoiceBranch] = useState<"goods" | "services">(doc.invoiceBranch ?? "goods");
  const [serviceProducts, setServiceProducts] = useState<PickerProduct[]>([]);
  const [serviceLoading, setServiceLoading] = useState(false);
  const [serviceError, setServiceError] = useState("");
  const [productSuggestions, setProductSuggestions] = useState<ProductMappingSuggestion[]>([]);
  const [applyingSuggestion, setApplyingSuggestion] = useState<number | null>(null);
  // Multi-pedido
  const [poOpen, setPoOpen] = useState(false);
  const [poCandidates, setPoCandidates] = useState<PoCandidate[]>([]);
  const [foundExactPo, setFoundExactPo] = useState(false);
  const [poLoading, setPoLoading] = useState(false);
  const [selectedPoIds, setSelectedPoIds] = useState<number[]>(doc.assignedPurchaseOrderIds ?? []);
  const [poSaving, setPoSaving] = useState(false);
  const [poMsg, setPoMsg] = useState("");
  const [acceptingPdfLines, setAcceptingPdfLines] = useState(false);
  // Mini navegador de Drive (Fase 2.4): alojar el PDF validado en su carpeta definitiva
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveMsg, setDriveMsg] = useState("");
  const [driveRootId, setDriveRootId] = useState("");
  const [driveFolders, setDriveFolders] = useState<{ id: string; name: string }[]>([]);
  const [drivePath, setDrivePath] = useState<{ id: string; name: string }[]>([]);
  const [driveFilter, setDriveFilter] = useState("");
  const [driveTarget, setDriveTarget] = useState<{ id: string; path: string } | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [moving, setMoving] = useState(false);
  // Fase 3: puente con Odoo (borrador + contabilizar)
  const [odooBusy, setOdooBusy] = useState(false);
  const [odooMsg, setOdooMsg] = useState("");
  const [draftConfirmation, setDraftConfirmation] = useState(false);
  const [draftCreated, setDraftCreated] = useState<{ id: number; reference: string; dueDate: string | null; total: number | null } | null>(null);
  const [validatingDraft, setValidatingDraft] = useState(false);
  const [accountingDate, setAccountingDate] = useState("");
  const [draftWriteEnabled, setDraftWriteEnabled] = useState(false);
  const [draftCapabilityChecking, setDraftCapabilityChecking] = useState(false);
  const [draftCapabilityError, setDraftCapabilityError] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatStage, setChatStage] = useState("Listo para revisar la factura.");
  const apiPath = api("/api/odoo/supplier-invoices/inbox");
  const previewUrl = `${apiPath}/preview?id=${encodeURIComponent(doc.driveFileId)}`;

  // La autorización puede activarse mientras el popup ya está abierto.
  useEffect(() => {
    if (!draftConfirmation) return;
    let cancelled = false;
    const check = async () => {
      if (!cancelled) setDraftCapabilityChecking(true);
      try {
        const response = await fetch(`${apiPath}/odoo-draft-capability?id=${encodeURIComponent(doc.driveFileId)}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "No se pudo comprobar el permiso de Odoo");
        if (!cancelled) {
          setDraftWriteEnabled(result.enabled === true);
          setDraftCapabilityError("");
        }
      } catch (error) {
        if (!cancelled) {
          setDraftWriteEnabled(false);
          setDraftCapabilityError(error instanceof Error ? error.message : "No se pudo comprobar el permiso de Odoo");
        }
      } finally {
        if (!cancelled) setDraftCapabilityChecking(false);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [draftConfirmation, apiPath, doc.driveFileId]);

  const askRaskibot = async (question = "") => {
    setChatOpen(true);
    setChatBusy(true);
    setChatStage(question ? "Enviando tu consulta a Raskibot…" : "Leyendo PDF y preparando cotejo…");
    try {
      setChatStage(question ? "Cotejando la duda con PDF y pedidos…" : "Identificando emisor, CIF, pedidos y líneas…");
      const r = await fetch(`${apiPath}/raskibot-extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [doc.driveFileId], ...(question ? { question } : {}) }) });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo iniciar el análisis");
      if (x.document) {
        onDocUpdated(x.document);
        const updated = x.document.extracted;
        if (updated) setFields({ supplier: updated.supplier ?? "", supplierVat: updated.supplierVat ?? "", country: updated.country ?? "", invoiceNumber: updated.invoiceNumber ?? "", invoiceDate: updated.invoiceDate ?? "", dueDate: updated.dueDate ?? "", currency: updated.currency ?? "", billingAddress: updated.billingAddress ?? "", base: updated.base != null ? String(updated.base) : "", taxes: updated.taxes != null ? String(updated.taxes) : "", total: updated.total != null ? String(updated.total) : "", docType: updated.docType ?? "" });
      }
      setChatInput("");
      setChatStage("Análisis terminado. Datos del PDF rellenados; coteja los productos de Odoo y confirma proveedor y pedidos antes del borrador.");
    } catch (e) {
      setChatStage(e instanceof Error ? e.message : "No se pudo contactar con Raskibot.");
    } finally { setChatBusy(false); }
  };

  const loadCatalog = async () => {
    setCatalogError("");
    if (catalog.length) return;
    setCatalogLoading(true);
    try {
      const r = await fetch(api("/api/odoo/products"));
      if (!r.ok) throw new Error("No se pudo cargar el catálogo");
      const x = await r.json();
      setCatalog(Array.isArray(x.products) ? x.products : []);
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : "No se pudo cargar el catálogo de productos");
    } finally {
      setCatalogLoading(false);
    }
  };

  const normalizedTerm = normalizeSearch(term);
  const raskibotOrderSuggestions = [...new Set((doc.extracted?.lines ?? [])
    .map((line) => Number(line.aiPurchaseOrderCandidateId))
    .filter((id) => Number.isInteger(id) && id > 0))];

  useEffect(() => {
    if (!pickerOpen || term.trim().length < 2) { setServiceProducts([]); setServiceError(""); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setServiceLoading(true);
      try {
        const response = await fetch(`${apiPath}/service-products?q=${encodeURIComponent(term.trim())}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "No se pudieron buscar servicios");
        setServiceProducts(Array.isArray(data.products) ? data.products : []);
        setServiceError("");
      } catch (error) { if (!controller.signal.aborted) setServiceError(error instanceof Error ? error.message : "Error buscando servicios"); }
      finally { if (!controller.signal.aborted) setServiceLoading(false); }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [pickerOpen, term, apiPath]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiPath}/product-suggestions?id=${encodeURIComponent(doc.driveFileId)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("suggestions")))
      .then((data) => { if (!controller.signal.aborted) setProductSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []); })
      .catch(() => {});
    return () => controller.abort();
  }, [apiPath, doc.driveFileId, doc.extracted?.lines]);

  useEffect(() => {
    const query = (fields.supplierVat || fields.supplier).trim();
    if (supplierAccepted) { setSupplierSuggestions([]); return; }
    if (query.length < 3) { setSupplierSuggestions([]); return; }
    const timer = window.setTimeout(async () => {
      setSupplierSuggestionsLoading(true);
      try {
        const r = await fetch(`${apiPath}/supplier-suggestions?q=${encodeURIComponent(query)}`);
        const x = await r.json();
        setSupplierSuggestions(r.ok && Array.isArray(x.items) ? x.items : []);
      } catch { setSupplierSuggestions([]); }
      finally { setSupplierSuggestionsLoading(false); }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [fields.supplier, fields.supplierVat, supplierAccepted]);
  useEffect(() => {
    setLines((doc.extracted?.lines ?? []).map((l) => ({ ...l })));
  }, [doc.driveFileId, doc.extracted?.lines]);
  useEffect(() => {
    if (!taxOptions.length) return;
    if (!lines.some((line) => line.taxId && line.taxAmount == null && line.total != null && taxOptions.some((tax) => tax.id === line.taxId && tax.type === "percent"))) return;
    setLines((current) => current.map((line) => {
      const tax = taxOptions.find((item) => item.id === line.taxId);
      if (!tax || tax.type !== "percent" || line.taxAmount != null || line.total == null) return line;
      const taxAmount = Math.round(line.total * tax.rate) / 100;
      return { ...line, taxRate: tax.rate, taxAmount, totalWithTax: Math.round((line.total + taxAmount) * 100) / 100 };
    }));
  }, [taxOptions, lines]);
  useEffect(() => {
    const loadOptions = async () => {
      try {
        const r = await fetch(`${apiPath}/line-options`);
        const x = await r.json();
        if (!r.ok) throw new Error(x.message || "No se pudieron cargar impuestos y cuentas");
        setTaxOptions(Array.isArray(x.taxes) ? x.taxes : []);
        setAccountOptions(Array.isArray(x.accounts) ? x.accounts : []);
      } catch (e) { setOptionError(e instanceof Error ? e.message : "No se pudieron cargar impuestos y cuentas"); }
    };
    void loadOptions();
  }, [apiPath]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!draggingSplit.current) return;
      const host = document.querySelector(".si-drawer-split") as HTMLElement | null;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const next = Math.max(28, Math.min(72, ((event.clientX - rect.left) / rect.width) * 100));
      setSplitPct(next);
      localStorage.setItem("supplier-invoice-pdf-width", String(next));
    };
    const up = () => { draggingSplit.current = false; };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);
  const results = [...new Map([...catalog, ...serviceProducts].map((item) => [item.id, item])).values()]
    .map((item) => {
      const reference = normalizeSearch(item.reference);
      const barcode = normalizeSearch(item.barcode);
      const name = normalizeSearch(item.name);
      const score = !normalizedTerm ? 3
        : reference === normalizedTerm || barcode === normalizedTerm ? 0
        : reference.startsWith(normalizedTerm) || barcode.startsWith(normalizedTerm) ? 1
        : name.startsWith(normalizedTerm) ? 2
        : [reference, barcode, name].some((value) => value.includes(normalizedTerm)) ? 3 : 99;
      return { item, score };
    })
    .filter(({ score }) => score < 99)
    .sort((a, b) => a.score - b.score || a.item.reference.localeCompare(b.item.reference, "es"))
    .slice(0, 10)
    .map(({ item }) => item);

  const addProduct = (product: PickerProduct) => {
    const isGeneric = product.type === "service" || product.type === "consu";
    if (linkingLineIndex !== null) {
      const current = lines[linkingLineIndex];
      const matchingOrders = invoiceBranch === "goods" ? poCandidates.filter((order) =>
        (doc.assignedPurchaseOrderIds ?? []).includes(order.id)
        && order.lines.some((source) => source.productId === product.id &&
          source.qtyReceived - source.qtyInvoiced + 0.0001 >= Number(current?.quantity ?? 0))) : [];
      const order = matchingOrders.length === 1 ? matchingOrders[0] : null;
      const source = order?.lines.find((line) => line.productId === product.id);
      setLines((prev) => prev.map((line, index) => index === linkingLineIndex ? {
        ...line,
        productId: product.id,
        // Conservar la referencia original del PDF para la equivalencia por proveedor.
        reference: line.reference || null,
        genericProductConfirmed: invoiceBranch === "services" && isGeneric,
        sourcePurchaseOrderId: order?.id ?? null,
        sourcePurchaseOrderName: order?.name ?? null,
        qtyOrdered: source?.qtyOrdered ?? null,
        qtyReceived: source?.qtyReceived ?? null,
        qtyInvoiced: source?.qtyInvoiced ?? null,
        qtyPending: source?.qtyPending ?? null,
        pdfPriceVerified: false,
      } : line));
      setLinkingLineIndex(null);
      setPickerOpen(false);
      setTerm("");
      setSaveMsg(order || invoiceBranch === "services"
        ? `Producto «${product.reference || product.name}» enlazado localmente${order ? ` con ${order.name}` : ""}. Guarda las líneas para conservarlo.`
        : `Producto «${product.reference || product.name}» elegido. Selecciona debajo su pedido de origen recibido y guarda las líneas.`);
      return;
    }
    setLines((prev) => [...prev, {
      productId: product.id,
      description: product.name,
      reference: product.reference || null,
      quantity: null,
      priceUnit: null,
      discount: null,
      taxNames: product.type === "service" ? [] : ["21%"],
      taxRate: product.type === "service" ? 0 : 21,
      taxAmount: null,
      totalWithTax: null,
      total: null,
      genericProductConfirmed: isGeneric,
    }]);
    setPickerOpen(false);
    setTerm("");
  };

  const acceptRaskibotProductCandidate = async (index: number, productId: number) => {
    if (applyingSuggestion !== null) return;
    setApplyingSuggestion(index);
    setSaveMsg("Comprobando la referencia del producto sugerido en Odoo…");
    try {
      const response = await fetch(`${apiPath}/product-candidate?id=${encodeURIComponent(doc.driveFileId)}&productId=${encodeURIComponent(productId)}`);
      const data = await response.json();
      if (!response.ok || !data.product) throw new Error(data.message || "No se pudo confirmar el producto sugerido");
      setLines((current) => current.map((line, lineIndex) => lineIndex === index ? {
        ...line,
        productId: Number(data.product.id),
        sourcePurchaseOrderId: null,
        sourcePurchaseOrderName: null,
        qtyOrdered: null,
        qtyReceived: null,
        qtyInvoiced: null,
        qtyPending: null,
        genericProductConfirmed: false,
        pdfPriceVerified: false,
      } : line));
      setSaveMsg(`Producto «${data.product.reference || data.product.name}» verificado por referencia exacta y seleccionado localmente. Guarda las líneas; el pedido se confirma por separado.`);
    } catch (error) { setSaveMsg(error instanceof Error ? error.message : "No se pudo comprobar el candidato de Raskibot"); }
    finally { setApplyingSuggestion(null); }
  };

  const acceptProductSuggestion = async (index: number, suggestion: NonNullable<ProductMappingSuggestion>) => {
    if (applyingSuggestion !== null) return;
    setApplyingSuggestion(index);
    setSaveMsg("Comprobando el producto sugerido en Odoo…");
    try {
      const response = await fetch(`${apiPath}/service-products?id=${suggestion.productId}`);
      const data = await response.json();
      const product = (data.products as PickerProduct[] | undefined)?.find((item) => item.id === suggestion.productId);
      if (!response.ok || !product) throw new Error(data.message || "El servicio sugerido ya no está activo en Odoo");
      updateLine(index, { productId: product.id, genericProductConfirmed: true });
      setSaveMsg(`Servicio «${product.name}» seleccionado. Guarda las líneas para conservar la elección.`);
    } catch (error) { setSaveMsg(error instanceof Error ? error.message : "No se pudo aplicar la sugerencia"); }
    finally { setApplyingSuggestion(null); }
  };

  const applyWebAdjustment = () => {
    let preview: ReturnType<typeof calculateWebAdjustment>;
    try {
      preview = calculateWebAdjustment({
        base: fields.base.trim() === "" ? null : Number(fields.base),
        taxes: fields.taxes.trim() === "" ? null : Number(fields.taxes),
        total: fields.total.trim() === "" ? null : Number(fields.total),
      }, lines);
    } catch (error) { setSaveMsg(error instanceof Error ? error.message : "No se pudo calcular el ajuste."); return; }
    const amount = preview.amount;
    if (amount === 0) { setSaveMsg("Los productos ya cuadran con la base del PDF; no queda importe para Ajuste Web."); return; }
    setLines((prev) => {
      const adjustment: ProductLineEdit = { productId: WEB_ADJUSTMENT_LOCAL_SENTINEL, description: "[AJUSTEWEB] Ajuste WEB", reference: null, quantity: 1, priceUnit: amount, discount: 0, taxNames: [], taxId: null, taxRate: 0, taxAmount: 0, totalWithTax: amount, accountId: null, accountName: null, total: amount, sourcePurchaseOrderId: null, sourcePurchaseOrderName: "Ajuste autorizado" };
      const index = prev.findIndex((line) => isWebAdjustmentProductId(line.productId));
      return index < 0 ? [...prev, adjustment] : prev.map((line, i) => i === index ? adjustment : line);
    });
    setSaveMsg(`Producto AJUSTEWEB preparado por ${money(amount, ex?.currency ?? "EUR")}, sin IVA. ${preview.taxDifference ? `Queda una diferencia de IVA de ${money(preview.taxDifference, ex?.currency ?? "EUR")}; revísala y usa «Cuadrar IVA con PDF» antes de guardar.` : "El IVA ya coincide con el PDF."}`);
  };

  const applyFiscalDefaults = () => {
    const tax = taxOptions.find((item) => item.id === bulkTaxId);
    const account = accountOptions.find((item) => item.id === bulkAccountId);
    if (!tax && !account) { setSaveMsg("Selecciona un IVA o una cuenta para aplicar."); return; }
    setLines((prev) => prev.map((line) => {
      // El Ajuste Web sigue siendo la excepción documentada: sin IVA.
      if (isWebAdjustmentProductId(line.productId)) return line;
      const next = {
        ...line,
        ...(tax ? { taxId: tax.id, taxRate: tax.type === "percent" ? tax.rate : null, taxNames: [tax.name] } : {}),
        ...(account ? { accountId: account.id, accountName: `${account.code} · ${account.name}` } : {}),
      };
      if (tax?.type === "percent" && next.total != null) {
        next.taxAmount = Math.round(next.total * tax.rate) / 100;
        next.totalWithTax = Math.round((next.total + next.taxAmount) * 100) / 100;
      }
      return next;
    }));
    setSaveMsg("IVA y cuenta aplicados localmente a las líneas. Revisa y guarda antes del borrador.");
  };

  const updateLine = (i: number, patch: Partial<ProductLineEdit>) => {
    const rates = [patch.discount, patch.discountExtra, patch.promptPaymentDiscount].filter((value) => value != null);
    if (rates.some((value) => !Number.isFinite(value) || value! < 0 || value! > 100 || Math.abs(value! * 1000 - Math.round(value! * 1000)) > 0.000001)) { setSaveMsg("Cada descuento debe estar entre 0 y 100% y tener como máximo tres decimales."); return; }
    setLines((prev) => prev.map((line, index) => index === i ? recalculateProductLine(line, patch) : line));
  };

  const applySequentialDiscounts = () => {
    const parseRate = (raw: string) => raw.trim() === "" ? 0 : Number(raw.replace(",", "."));
    const extra = parseRate(bulkExtraDiscount);
    const prompt = parseRate(bulkPromptDiscount);
    if (![extra, prompt].every((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 100 && Math.abs(rate * 1000 - Math.round(rate * 1000)) < 0.000001)) {
      setSaveMsg("Introduce descuentos extra y de pronto pago entre 0 y 100%, con tres decimales como máximo."); return;
    }
    if (!lines.some((line) => !isWebAdjustmentProductId(line.productId))) { setSaveMsg("No hay líneas de producto a las que aplicar descuentos."); return; }
    if (lines.some((line) => !isWebAdjustmentProductId(line.productId) && (!line.taxId || line.taxRate == null))) {
      setSaveMsg("Selecciona primero un IVA porcentual en todas las líneas gravadas para recalcular sus cuotas."); return;
    }
    if (lines.some((line) => isWebAdjustmentProductId(line.productId) && (line.total ?? 0) < 0)) {
      setSaveMsg("Retira primero el Ajuste Web negativo: los descuentos sujetos a IVA se aplican sobre las líneas, no se duplican con ese ajuste."); return;
    }
    setLines((current) => current.map((line) => isWebAdjustmentProductId(line.productId) ? line : recalculateProductLine(line, { discountExtra: extra, promptPaymentDiscount: prompt })));
    setSaveMsg(`Descuentos sucesivos ${extra}% y ${prompt}% aplicados a las líneas gravadas. Base e IVA recalculados; revisa el cotejo y guarda las líneas.`);
  };

  const applyTaxTotal = (raw: string) => {
    setTaxTotalEdit(null);
    const target = Number(raw);
    if (!raw.trim() || !Number.isFinite(target) || target < 0 || Math.abs(target * 100 - Math.round(target * 100)) > 0.000001) {
      setSaveMsg("Introduce un impuesto total válido, con dos decimales como máximo.");
      return;
    }
    const eligible = lines.map((line, index) => ({ line, index })).filter(({ line }) => !isWebAdjustmentProductId(line.productId) && line.taxId && line.taxAmount != null);
    const taxIds = new Set(eligible.map(({ line }) => line.taxId));
    if (!eligible.length || taxIds.size !== 1 || lines.some((line) => !isWebAdjustmentProductId(line.productId) && line.taxAmount == null)) {
      setSaveMsg("Para ajustar el total, confirma primero las cuotas de todas las líneas. Si hay varios impuestos, ajusta cada cuota en su línea.");
      return;
    }
    const current = Math.round(lines.reduce((sum, line) => sum + (line.taxAmount ?? 0), 0) * 100);
    let delta = Math.round(target * 100) - current;
    const next = lines.map((line) => ({ ...line }));
    for (const { index } of [...eligible].reverse()) {
      if (!delta) break;
      const oldCents = Math.round((next[index].taxAmount ?? 0) * 100);
      const applied = delta < 0 ? Math.max(-oldCents, delta) : delta;
      next[index].taxAmount = (oldCents + applied) / 100;
      next[index].totalWithTax = Math.round(((next[index].total ?? 0) + next[index].taxAmount!) * 100) / 100;
      delta -= applied;
    }
    if (delta) { setSaveMsg("El ajuste dejaría una cuota negativa. Revisa las cuotas de cada línea."); return; }
    const base = Math.round(next.reduce((sum, line) => sum + (line.total ?? 0), 0) * 100) / 100;
    setLines(next);
    setFields((currentFields) => ({ ...currentFields, base: String(base), taxes: target.toFixed(2), total: (base + target).toFixed(2) }));
    setManualTaxTotal(true);
    setSaveMsg("Impuesto total ajustado en la línea gravada. Guarda las líneas; el borrador de Odoo deberá confirmar el mismo importe.");
  };

  const applySupplierSuggestion = async (supplier: SupplierSuggestion) => {
    const next = { ...fields, supplier: supplier.name, supplierVat: supplier.vat ?? "", country: supplier.country ?? "", billingAddress: supplier.billingAddress ?? "" };
    setSavingFields(true);
    setFieldsMsg("Guardando proveedor y recotejando con Odoo…");
    try {
      const r = await fetch(`${apiPath}/fields`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.driveFileId, fields: { ...next, confirmedOdooPartnerId: supplier.id, invoiceBranch } }) });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo guardar el proveedor");
      setFields(next);
      setSupplierAccepted(true);
      setSupplierSuggestions([]);
      if (x.document) onDocUpdated(x.document);
      setConfirmedPartnerId(supplier.id);
      const mappedTax = Number(x.mapping?.defaultTaxId);
      const mappedAccount = Number(x.mapping?.defaultAccountId);
      if (Number.isFinite(mappedTax) && mappedTax > 0) setBulkTaxId(mappedTax);
      if (Number.isFinite(mappedAccount) && mappedAccount > 0) setBulkAccountId(mappedAccount);
      if ((Number.isFinite(mappedTax) && mappedTax > 0) || (Number.isFinite(mappedAccount) && mappedAccount > 0)) {
        const tax = taxOptions.find((item) => item.id === mappedTax);
        const account = accountOptions.find((item) => item.id === mappedAccount);
        setLines((prev) => prev.map((line) => isWebAdjustmentProductId(line.productId) ? line : ({
          ...line,
          ...(tax ? { taxId: tax.id, taxRate: tax.type === "percent" ? tax.rate : 0, taxNames: [tax.name] } : {}),
          ...(account ? { accountId: account.id, accountName: `${account.code} · ${account.name}` } : {}),
        })));
      }
      setFieldsMsg(`Proveedor «${supplier.name}» aplicado y cotejo actualizado.`);
    } catch (e) {
      setFieldsMsg(e instanceof Error ? e.message : "No se pudo recotejar el proveedor");
    } finally { setSavingFields(false); }
  };

  const removeLine = (i: number) => {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  };

  const saveLinesLocal = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const r = await fetch(`${apiPath}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.driveFileId, lines, ...(manualTaxTotal ? { manualTaxTotal: Number(fields.taxes) } : {}) }),
      });
      const x = await readSaveResponse(r);
      if (!r.ok) throw new Error(x.message || "No se pudo guardar");
      if (x.document) onDocUpdated(x.document);
      setManualTaxTotal(false);
      setSaveMsg("Líneas guardadas en el registro local del LAB.");
      const mappedTax = Number(x.fiscalDefaults?.defaultTaxId);
      const mappedAccount = Number(x.fiscalDefaults?.defaultAccountId);
      if (Number.isFinite(mappedTax) && mappedTax > 0) setBulkTaxId(mappedTax);
      if (Number.isFinite(mappedAccount) && mappedAccount > 0) setBulkAccountId(mappedAccount);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Error guardando líneas");
    } finally {
      setSaving(false);
    }
  };

  const saveFields = async () => {
    if (savingFields || saving) return;
    setSavingFields(true);
    setFieldsMsg("Guardando proveedor y productos del borrador local…");
    try {
      const r = await fetch(`${apiPath}/fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.driveFileId, fields: { ...fields, confirmedOdooPartnerId: confirmedPartnerId, invoiceBranch } }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo guardar");
      const lineResponse = await fetch(`${apiPath}/lines`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.driveFileId, lines }),
      });
      const lineResult = await lineResponse.json();
      if (!lineResponse.ok) {
        if (x.document) onDocUpdated(x.document);
        throw new Error(`Proveedor guardado, pero no las líneas: ${lineResult.message || "reintenta Guardar líneas"}`);
      }
      if (lineResult.document) onDocUpdated(lineResult.document);
      setFieldsMsg(x.mapping?.learned
        ? `Datos y productos guardados. Proveedor «${x.mapping.supplierName}» y equivalencias recordados para próximas facturas.`
        : "Datos y productos guardados.");
    } catch (e) {
      setFieldsMsg(e instanceof Error ? e.message : "Error guardando datos");
    } finally {
      setSavingFields(false);
    }
  };

  const loadPoCandidates = async () => {
    setPoLoading(true);
    setPoMsg("");
    try {
      const r = await fetch(`${apiPath}/po-filter?id=${encodeURIComponent(doc.driveFileId)}&branch=${encodeURIComponent(invoiceBranch)}`);
      const x = await r.json();
      if (!r.ok) throw new Error(x.message);
      const nextOrders: PoCandidate[] = x.orders ?? [];
      const isFresh = x.freshness?.source === "live_odoo";
      setPoCandidates(nextOrders);
      const branchConflict = Boolean(x.branchConflict);
      const explicit = new Set<string>(x.explicitReferences ?? []);
      const sourceOrders = nextOrders.filter((order) => explicit.has(order.name));
      setFoundExactPo(sourceOrders.length > 0);
      if (sourceOrders.length) {
        setPoOpen(true);
        if (isFresh) {
          if (!(doc.assignedPurchaseOrderIds?.length) && !branchConflict) setSelectedPoIds(sourceOrders.map((order) => order.id));
          setPoMsg(`${sourceOrders.map((order) => order.name).join(", ")} verificado en Odoo ahora. Revisa los pedidos y guarda la asociación; sólo se seleccionarán las líneas presentes en el PDF.`);
        } else {
          setPoMsg(`La lista de pedidos viene de caché (${x.freshness?.refreshedAt ?? "fecha desconocida"}); no se preselecciona ${sourceOrders.map((order) => order.name).join(", ")}. Confirma el proveedor Odoo y vuelve a cargar antes de asociar.`);
        }
      } else if (!isFresh) {
        setPoMsg(`La lista de pedidos viene de caché (${x.freshness?.refreshedAt ?? "fecha desconocida"}); confirma el proveedor Odoo y vuelve a cargar para consultar pedidos actuales.`);
      }
      const allowed = new Set(nextOrders.map((order) => order.id));
      setSelectedPoIds((current) => current.filter((id) => allowed.has(id)));
      if (!x.orders?.length && isFresh && !branchConflict) setPoMsg("Odoo no devuelve pedidos pendientes de facturar para el proveedor confirmado.");
      if (branchConflict) {
        setPoOpen(true);
        setPoMsg("Conflicto de clasificación: el PDF contiene referencias de pedido (" + (x.referenceEvidence ?? []).map((item: any) => item.normalized).join(", ") + "), pero esta factura está marcada como servicio. Revisa la rama y los pedidos; no se cambió ni asoció nada automáticamente.");
      }
    } catch (e) {
      setPoMsg(e instanceof Error ? e.message : "Error cargando pedidos");
    } finally {
      setPoLoading(false);
    }
  };

  useEffect(() => { void loadPoCandidates(); }, [doc.driveFileId, doc.extracted?.lines, doc.confirmedOdooPartnerId, invoiceBranch]);

  const togglePo = (poId: number) => {
    setSelectedPoIds((prev) => prev.includes(poId) ? prev.filter((n) => n !== poId) : [...prev, poId]);
  };

  const acceptPdfLinesWithoutOrder = async () => {
    if (acceptingPdfLines) return;
    setAcceptingPdfLines(true);
    setPoMsg("Guardando líneas del PDF en el borrador local…");
    try {
      const r = await fetch(`${apiPath}/no-po-lines`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.driveFileId }) });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudieron incluir las líneas");
      if (x.document) onDocUpdated(x.document);
      setInvoiceBranch("services");
      setPoMsg(`${x.document?.extracted?.lines?.length ?? 0} líneas del PDF incluidas en el borrador local, sin crear productos en Odoo.`);
    } catch (error) { setPoMsg(error instanceof Error ? error.message : "No se pudieron guardar las líneas"); }
    finally { setAcceptingPdfLines(false); }
  };

  const savePoLink = async () => {
    const partnerId = confirmedPartnerId ?? doc.confirmedOdooPartnerId;
    if (!partnerId) {
      setPoMsg("Confirma el proveedor en Odoo antes de guardar proveedor y pedidos.");
      return;
    }
    if (invoiceBranch === "goods" && !selectedPoIds.length) {
      setPoMsg("Selecciona al menos un pedido; si la factura no tiene pedido, confirma la rama Servicios.");
      return;
    }
    if (poSaving) return;
    setPoSaving(true);
    setPoMsg("Revalidando proveedor y pedidos en Odoo; preparando el cotejo local…");
    try {
      const r = await fetch(`${apiPath}/confirm-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: doc.driveFileId,
          confirmedOdooPartnerId: partnerId,
          purchaseOrderIds: selectedPoIds,
          invoiceBranch,
          fields: { ...fields, confirmedOdooPartnerId: partnerId, invoiceBranch },
        }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo guardar");
      if (x.document) onDocUpdated(x.document);
      setPoMsg(`Proveedor verificado y cotejo guardado en LAB. ${selectedPoIds.length ? `Pedidos: ${selectedPoIds.join(", ")}.` : "Rama de servicios sin pedido."}`);
    } catch (e) {
      setPoMsg(e instanceof Error ? e.message : "Error guardando asociación");
    } finally {
      setPoSaving(false);
    }
  };

  // ===== Mini navegador de Drive =====

  const loadFolders = async (folderId: string | null) => {
    setDriveLoading(true);
    setDriveMsg("");
    try {
      const q = folderId ? `?folder=${encodeURIComponent(folderId)}` : "";
      const r = await fetch(`${apiPath}/drive/browse${q}`);
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "Error cargando carpetas");
      if (!folderId && x.folderId) setDriveRootId(x.folderId);
      setDriveFolders(x.folders ?? []);
      return true;
    } catch (e) {
      setDriveMsg(e instanceof Error ? e.message : "Error cargando carpetas");
      return false;
    } finally {
      setDriveLoading(false);
    }
  };

  const openDrive = async () => {
    const next = !driveOpen;
    setDriveOpen(next);
    if (next && !driveRootId) {
      await loadFolders(null);
    }
  };

  const enterFolder = async (folder: { id: string; name: string }) => {
    const ok = await loadFolders(folder.id);
    if (ok) { setDrivePath((p) => [...p, folder]); setDriveTarget(null); setDriveFilter(""); }
  };

  const goUp = async () => {
    const parent = drivePath.length > 1 ? drivePath[drivePath.length - 2].id : null;
    const ok = await loadFolders(parent);
    if (ok) { setDrivePath((p) => p.slice(0, -1)); setDriveTarget(null); setDriveFilter(""); }
  };

  const createFolderHere = async () => {
    const name = newFolderName.trim();
    const parentId = drivePath.length ? drivePath[drivePath.length - 1].id : driveRootId;
    if (!name || !parentId) return;
    setCreatingFolder(true);
    setDriveMsg("");
    try {
      const r = await fetch(`${apiPath}/drive/create-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.driveFileId, parentId, name }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo crear la carpeta");
      setNewFolderName("");
      const ok = await loadFolders(x.folder.id);
      if (ok) {
        setDrivePath((p) => [...p, { id: x.folder.id, name: x.folder.name ?? name }]);
        setDriveTarget(null);
        setDriveFilter("");
        setDriveMsg(`Carpeta creada: ${x.path}. Selecciona «Usar carpeta actual» para archivar el PDF.`);
      }
    } catch (e) {
      setDriveMsg(e instanceof Error ? e.message : "Error creando carpeta");
    } finally {
      setCreatingFolder(false);
    }
  };

  const selectCurrentFolder = () => {
    if (!drivePath.length) { setDriveMsg("Navega hasta una subcarpeta de FACTURAS."); return; }
    const path = "/FACTURAS/" + drivePath.map((c) => c.name).join("/");
    setDriveTarget({ id: drivePath[drivePath.length - 1].id, path });
    setDriveMsg(`Destino seleccionado: ${path}. Pulsa «Guardar PDF aquí» para moverlo.`);
  };

  const movePdf = async () => {
    if (!driveTarget) return;
    setMoving(true);
    setDriveMsg("");
    try {
      const r = await fetch(`${apiPath}/drive/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.driveFileId, targetFolderId: driveTarget.id }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo mover el PDF");
      if (x.document) onDocUpdated(x.document);
      setDriveMsg(`PDF guardado en ${x.targetFolderPath}.`);
    } catch (e) {
      setDriveMsg(e instanceof Error ? e.message : "Error moviendo el PDF");
    } finally {
      setMoving(false);
    }
  };

  // ===== Fase 3: Odoo (borrador + contabilizar) =====

  const createOdooDraft = async () => {
    if (odooBusy) return;
    setOdooBusy(true);
    setOdooMsg("");
    try {
      const r = await fetch(`${apiPath}/odoo-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.driveFileId, accountingDate }) });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo crear el borrador");
      if (x.document) onDocUpdated(x.document);
      setDraftConfirmation(false);
      const res = x.result ?? {};
      const actual = res.actual;
      setDraftCreated({ id: Number(res.moveId), reference: actual?.reference ?? doc.extracted?.invoiceNumber ?? "", dueDate: actual?.dueDate ?? null, total: actual?.total ?? null });
      setOdooMsg(`Borrador creado en Odoo (ID ${res.moveId}).` +
        (actual ? ` Odoo calculó base ${actual.base.toFixed(2)} €, IVA ${actual.taxes.toFixed(2)} € y total ${actual.total.toFixed(2)} € en ${actual.lines.length} líneas; PDF ${doc.extracted?.total ?? "—"} €.` : " Revisa sus importes en Odoo.") +
        (res.warnings?.length ? ` Avisos: ${res.warnings.join(" · ")}` : ""));
    } catch (e) {
      setOdooMsg(e instanceof Error ? e.message : "Error creando borrador");
    } finally {
      setOdooBusy(false);
    }
  };

  const validateAndReviewDraft = async () => {
    if (validatingDraft || odooBusy) return;
    if (invoiceBranch !== (doc.invoiceBranch ?? "goods") || confirmedPartnerId !== (doc.confirmedOdooPartnerId ?? null) ||
        JSON.stringify(lines) !== JSON.stringify(doc.extracted?.lines ?? []) ||
        fields.supplier !== (doc.extracted?.supplier ?? "") ||
        fields.supplierVat !== (doc.extracted?.supplierVat ?? "") ||
        fields.invoiceNumber !== (doc.extracted?.invoiceNumber ?? "") ||
        fields.invoiceDate !== (doc.extracted?.invoiceDate ?? "") ||
        fields.dueDate !== (doc.extracted?.dueDate ?? "") ||
        fields.currency !== (doc.extracted?.currency ?? "") ||
        fields.base !== (doc.extracted?.base == null ? "" : String(doc.extracted.base)) ||
        fields.taxes !== (doc.extracted?.taxes == null ? "" : String(doc.extracted.taxes)) ||
        fields.total !== (doc.extracted?.total == null ? "" : String(doc.extracted.total))) {
      setOdooMsg("Guarda primero los campos y las líneas modificados antes de validar.");
      return;
    }
    setValidatingDraft(true);
    setOdooMsg("");
    try {
      if (doc.status !== "VALIDADA") {
        const r = await fetch(`${apiPath}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.driveFileId, status: "VALIDADA" }) });
        const x = await r.json();
        if (!r.ok) throw new Error(x.message || "No se pudo validar el cotejo");
        if (x.document) onDocUpdated(x.document);
      }
      const capability = await fetch(`${apiPath}/odoo-draft-capability?id=${encodeURIComponent(doc.driveFileId)}`);
      const access = await capability.json();
      if (!capability.ok) throw new Error(access.message || "No se pudo comprobar el permiso de escritura en Odoo");
      setDraftWriteEnabled(access.enabled === true);
      setDraftConfirmation(true);
    } catch (e) {
      setOdooMsg(e instanceof Error ? e.message : "Error validando la factura");
    } finally {
      setValidatingDraft(false);
    }
  };

  const projectedLines = lines.map((line) => {
    const base = discountedBase(line.quantity ?? 0, line.priceUnit ?? 0, line.discount, line.discountExtra, line.promptPaymentDiscount);
    const tax = line.taxRate == null ? null : Math.round(base * line.taxRate) / 100;
    return { line, base, tax };
  });
  const projectedBase = projectedLines.reduce((sum, row) => sum + row.base, 0);
  const projectedTax = projectedLines.reduce((sum, row) => sum + (row.tax ?? 0), 0);
  const amountReviewWarnings: string[] = [];
  const declaredBase = fields.base.trim() === "" ? null : Number(fields.base.replace(",", "."));
  const declaredTaxes = fields.taxes.trim() === "" ? null : Number(fields.taxes.replace(",", "."));
  const declaredTotal = fields.total.trim() === "" ? null : Number(fields.total.replace(",", "."));
  const addAmountWarning = (label: string, actual: number, expected: number | null) => {
    if (expected != null && Number.isFinite(expected) && Math.abs(Math.round((actual - expected) * 100) / 100) > 0.01) {
      amountReviewWarnings.push(`${label}: ${money(actual, ex?.currency ?? "EUR")} frente a ${money(expected, ex?.currency ?? "EUR")} en la factura.`);
    }
  };
  if (declaredBase != null && declaredTaxes != null && declaredTotal != null && [declaredBase, declaredTaxes, declaredTotal].every(Number.isFinite)) {
    addAmountWarning("Base + impuestos", declaredBase + declaredTaxes, declaredTotal);
    addAmountWarning("Base de líneas", lines.reduce((sum, line, index) => sum + (line.total ?? projectedLines[index].base), 0), declaredBase);
    if (lines.every((line) => line.taxAmount != null)) {
      addAmountWarning("Impuestos de líneas", lines.reduce((sum, line) => sum + Number(line.taxAmount ?? 0), 0), declaredTaxes);
    }
    addAmountWarning("Total de líneas", lines.reduce((sum, line, index) => sum + (line.totalWithTax ?? ((line.total ?? projectedLines[index].base) + (line.taxAmount ?? 0))), 0), declaredTotal);
  }
  let webAdjustmentPreview: ReturnType<typeof calculateWebAdjustment> | null = null;
  let webAdjustmentError = "";
  try {
    webAdjustmentPreview = calculateWebAdjustment({
      base: fields.base.trim() === "" ? null : Number(fields.base),
      taxes: fields.taxes.trim() === "" ? null : Number(fields.taxes),
      total: fields.total.trim() === "" ? null : Number(fields.total),
    }, lines);
  } catch (error) { webAdjustmentError = error instanceof Error ? error.message : "No se pudo calcular el ajuste."; }

  const isExcluded = doc.match?.excluded === true;
  return (
    <div className="si-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside className={`si-drawer si-drawer-wide`}>
        <button className="si-close" onClick={close}><X /></button>
        <p className="eyebrow">Documento</p>
        <h2>{doc.name}</h2>
        <span className={`si-badge doc-${doc.status}`}>{STATUS_ES[doc.status] ?? doc.status}</span>
        {ex?.docType && <span className={"si-doc-type-badge" + (isExcluded ? " no-factura" : "")}>
          {DOC_TYPE_ES[ex.docType] ?? ex.docType}
        </span>}
        {doc.ocrStatus === "needs_ocr" && <p className="si-warn"><AlertTriangle /> PDF escaneado sin capa de texto: OCR pendiente (fase posterior).</p>}
        <div className="si-doc-actions si-scan-top">
          <button type="button" disabled={extracting !== null || isExcluded || chatBusy} onClick={() => void askRaskibot()} title="Lee solo este PDF y propone datos para revisar">
            {chatBusy || extracting === doc.driveFileId ? <RefreshCw className="spin" /> : <Sparkles />} {chatBusy || extracting === doc.driveFileId ? "Analizando…" : "Escanear con IA"}
          </button>
        </div>

        <div className="si-drawer-split" style={{ gridTemplateColumns: `${splitPct}% 12px minmax(0, 1fr)` }}>
          <div className="si-pdf-pane">
            <h3><FileText size={14} /> PDF · streaming directo desde Drive</h3>
            <iframe className="si-pdf-frame" src={previewUrl} title={`Visor PDF: ${doc.name}`} />
            <a className="si-primary si-pdf-open" href={previewUrl} target="_blank" rel="noopener noreferrer">
              <FileText size={14} /> Abrir PDF
            </a>
          </div>

          <div className="si-split-resizer" role="separator" aria-label="Ajustar ancho de PDF y edición" aria-orientation="vertical" tabIndex={0}
            onPointerDown={(event) => { draggingSplit.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
            onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { const next = Math.max(28, Math.min(72, splitPct + (event.key === "ArrowLeft" ? -4 : 4))); setSplitPct(next); localStorage.setItem("supplier-invoice-pdf-width", String(next)); } }} />

          <div className="si-form-pane">
            {isExcluded && (
              <p className="si-warn"><AlertTriangle /> No es una factura ({DOC_TYPE_ES[ex?.docType ?? ""] ?? ex?.docType ?? "documento"}): excluido del cotejo con Odoo. El operario lo moverá fuera de la carpeta SIN REVISAR.</p>
            )}

            <section>
              <h3>Datos extraídos</h3>
              <div className="si-edit-fields">
                <label>Proveedor
                  <input value={fields.supplier} onChange={(e) => { setSupplierAccepted(false); setConfirmedPartnerId(null); setFields({ ...fields, supplier: e.target.value }); }} placeholder="Razón social" aria-autocomplete="list" aria-controls="si-supplier-suggestions" />
                </label>
                <label>NIF/VAT
                  <input value={fields.supplierVat} onChange={(e) => { setSupplierAccepted(false); setConfirmedPartnerId(null); setFields({ ...fields, supplierVat: e.target.value }); }} placeholder="ESB12345678" />
                </label>
                <label>Nº factura
                  <input value={fields.invoiceNumber} onChange={(e) => setFields({ ...fields, invoiceNumber: e.target.value })} />
                </label>
                <label>País
                  <input value={fields.country} onChange={(e) => setFields({ ...fields, country: e.target.value })} placeholder="ES" />
                </label>
                <label>Fecha factura
                  <input type="date" value={fields.invoiceDate} onChange={(e) => setFields({ ...fields, invoiceDate: e.target.value })} />
                </label>
                <label>Vencimiento
                  <input type="date" value={fields.dueDate} onChange={(e) => setFields({ ...fields, dueDate: e.target.value })} />
                </label>
                <label>Moneda
                  <input value={fields.currency} onChange={(e) => setFields({ ...fields, currency: e.target.value })} placeholder="EUR" />
                </label>
                <label>Dirección facturación
                  <input value={fields.billingAddress} onChange={(e) => setFields({ ...fields, billingAddress: e.target.value })} />
                </label>
                <label>Base
                  <input type="number" step="0.01" min="0" value={fields.base} onChange={(e) => setFields({ ...fields, base: e.target.value })} />
                </label>
                <label>Impuestos
                  <input type="number" step="0.01" min="0" value={fields.taxes} onChange={(e) => setFields({ ...fields, taxes: e.target.value })} />
                </label>
                <label>Total
                  <input type="number" step="0.01" min="0" value={fields.total} onChange={(e) => setFields({ ...fields, total: e.target.value })} />
                </label>
                <label>Confianza
                  <input value={doc.confidence != null ? `${doc.confidence}%` : "—"} disabled />
                </label>
                <label>Tipo de documento
                  <select value={fields.docType} onChange={(e) => setFields({ ...fields, docType: e.target.value })}>
                    <option value="">(sin clasificar)</option>
                    <option value="factura">Factura</option>
                    <option value="albaran">Albarán / entrega</option>
                    <option value="aduana">Aduana</option>
                    <option value="transporte">Transporte</option>
                    <option value="otro">Otro</option>
                  </select>
                </label>
              </div>
              {(supplierSuggestionsLoading || supplierSuggestions.length > 0) && (
                <div className="si-product-picker">
                  <small>{supplierSuggestionsLoading ? "Buscando proveedores en Odoo…" : "Sugerencias de la ficha de proveedor en Odoo:"}</small>
                  {!supplierSuggestionsLoading && <ul id="si-supplier-suggestions" className="si-product-suggestions" role="listbox">
                    {supplierSuggestions.map((supplier) => (
                      <li key={supplier.id} role="option"><button type="button" disabled={savingFields} onClick={() => void applySupplierSuggestion(supplier)}>
                        <strong>{supplier.name}</strong><small>{supplier.vat || "Sin NIF"}{supplier.country ? ` · ${supplier.country}` : ""}{supplier.billingAddress ? ` · ${supplier.billingAddress}` : ""}</small>
                      </button></li>
                    ))}
                  </ul>}
                </div>
              )}
              <label className="si-editor-field"><span>Tipo de factura</span>
                <select value={invoiceBranch} onChange={(e) => setInvoiceBranch(e.target.value as "goods" | "services")}>
                  <option value="goods">Mercancía con pedido de compra confirmado</option>
                  <option value="services">Servicio o comisión sin pedido de compra</option>
                </select>
              </label>
              {invoiceBranch === "services" && <p className="si-note">Sin pedido de compra. Las líneas proceden del PDF y no crean productos en Odoo. Si una línea no tiene producto asociado, revisa su descripción, cuenta contable, IVA y cuota antes de validar.</p>}
              <p className="si-note">{confirmedPartnerId ? `Proveedor Odoo confirmado #${confirmedPartnerId}` : "Selecciona un proveedor de la lista Odoo para confirmar su identidad antes de validar servicios sin pedido."} Guarda estos datos para conservar la selección.</p>
              <button className="si-editor-add" disabled={savingFields || saving} onClick={() => void saveFields()} type="button">
                {savingFields ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />} Guardar datos (y aprender proveedor)
              </button>
              {fieldsMsg && <p className={fieldsMsg.startsWith("Datos") || fieldsMsg.startsWith("Guardando") ? "si-msg" : "error"} role="status">{fieldsMsg}</p>}
              <p className="si-note">Todos los campos son editables. Al guardar se recuerda el proveedor corregido: sus próximas facturas se auto-rellenarán con lo aprendido.</p>
              {ex?.warnings?.length ? <p className="si-warn"><AlertTriangle /> {ex.warnings.join(" · ")}</p> : null}
            </section>

            {invoiceBranch === "services" && !isExcluded && (
              <section>
                <h3>Cotejo de servicios sin pedido</h3>
                <p className="si-note">La coincidencia con pedidos de compra no aplica. Base {money(ex?.base ?? 0, ex?.currency ?? "EUR")} + IVA {money(ex?.taxes ?? 0, ex?.currency ?? "EUR")} = total {money(ex?.total ?? 0, ex?.currency ?? "EUR")}. Guarda el tipo de factura y revisa las líneas antes de validar.</p>
                {doc.match?.invoiceNameOdoo && <p className="si-warn"><AlertTriangle /> Posible duplicado: ya existe {doc.match.invoiceNameOdoo} en Odoo.</p>}
              </section>
            )}
            {doc.match && invoiceBranch !== "services" && !isExcluded && (
              <section>
                <h3>Cotejo con Odoo</h3>
                <p className="si-match-line">
                  <b>{doc.match.purchaseOrderName || "Sin candidato"}</b>
                  <span className={`si-match si-match-${doc.match.band}`}>{doc.match.score}% · {BAND_ES[doc.match.band]}</span>
                  {doc.match.totalDiff != null && <small>Diferencia total: {doc.match.totalDiff >= 0 ? "+" : ""}{money(doc.match.totalDiff)}</small>}
                </p>
                <ul className="si-criteria">
                  {doc.match.criteria.map((c) => (
                    <li key={c.key} className={c.ok ? "ok" : "bad"}>
                      {c.ok ? <CheckCircle2 size={14} /> : <X size={14} />} {c.label} — {c.detail}
                    </li>
                  ))}
                </ul>
                {doc.match.invoiceNameOdoo && <p className="si-warn"><AlertTriangle /> Posible duplicado: ya existe {doc.match.invoiceNameOdoo} en Odoo.</p>}
              </section>
            )}

            <section className="si-review-chat">
              <h3>Revisión con Raskibot</h3>
              <p className="si-note">Rellena los datos que constan en el PDF; los pedidos y productos se cotejan con Odoo. No crea borradores.</p>
              <button className="si-editor-add" type="button" onClick={() => void askRaskibot()} disabled={chatBusy}>
                {chatBusy ? <RefreshCw className="spin" size={14} /> : <Sparkles size={14} />} {chatOpen ? "Actualizar análisis" : "Abrir chat y extraer con IA"}
              </button>
              {chatOpen && <>
                <p className="si-chat-stage" role="status">{chatStage}</p>
                <div className="si-chat-log" aria-live="polite">
                  {(doc.reviewChat ?? []).length ? (doc.reviewChat ?? []).map((message, index) => <p key={`${message.at}-${index}`} className={`si-chat-${message.role}`}><b>{message.role === "user" ? "Operador" : message.role === "assistant" ? "Raskibot" : "Sistema"}:</b> {message.content}</p>) : <p className="si-note">Todavía no hay mensajes. Inicia la extracción o pregunta algo de esta factura.</p>}
                </div>
                <div className="si-chat-compose"><input value={chatInput} maxLength={1000} onChange={(e) => setChatInput(e.target.value)} placeholder="Ej.: MH es horizontal móvil, ¿qué líneas cambian?" aria-label="Pregunta para Raskibot" /><button type="button" className="si-editor-add" disabled={chatBusy || !chatInput.trim()} onClick={() => void askRaskibot(chatInput.trim())}>Preguntar</button></div>
              </>}
            </section>

            {!isExcluded && (
              <section>
                <h3>¿Varios pedidos en una factura?</h3>
                {!poLoading && !foundExactPo && !doc.assignedPurchaseOrderIds?.length && (doc.extracted?.lines.length ?? 0) > 0 && (
                  <div className="si-note">
                    <p>No se ha identificado una referencia única de pedido de compra. La IA ha leído {doc.extracted?.lines.length} línea(s) del PDF. ¿Quieres incluirlas en este borrador sin asociar un pedido ni crear productos en Odoo?</p>
                    <button className="si-editor-add" type="button" disabled={acceptingPdfLines || doc.pdfLinesAccepted === true} onClick={() => void acceptPdfLinesWithoutOrder()}>
                      {acceptingPdfLines ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />} {acceptingPdfLines ? "Guardando líneas…" : doc.pdfLinesAccepted ? "Líneas del PDF incluidas" : "Incluir líneas del PDF"}
                    </button>
                  </div>
                )}
                {raskibotOrderSuggestions.length > 0 && <div className="si-note si-raskibot-order-suggestions">
                  <b>Sugerencia de Raskibot (sin guardar):</b> referencia exacta de pedido encontrada. Revísala y preselecciónala; después confirma la asociación en la lista.
                  {raskibotOrderSuggestions.map((id) => {
                    const order = poCandidates.find((candidate) => candidate.id === id);
                    return <button key={id} className="si-link-product" type="button" disabled={poLoading || poSaving} onClick={() => {
                      setPoOpen(true);
                      setSelectedPoIds((current) => current.includes(id) ? current : [...current, id]);
                      setPoMsg(`Raskibot propone ${order?.name ?? `pedido #${id}`}; queda preseleccionado para que lo revises. Pulsa «Guardar asociación» solo si corresponde.`);
                    }}>Revisar y preseleccionar {order?.name ?? `pedido #${id}`}</button>;
                  })}
                </div>}
                <p className="si-note">Si esta factura agrupa varios pedidos de compra, asígnalos aquí: se muestran los pedidos sin facturar del proveedor, del más reciente al más antiguo, con lo pedido, lo recibido y lo facturado.</p>
                <button className="si-editor-add" disabled={poLoading} onClick={() => { if (!poOpen) void loadPoCandidates(); setPoOpen((v) => !v); }} type="button">
                  {poLoading ? <RefreshCw className="spin" size={14} /> : <ShoppingCart size={14} />} {poOpen ? "Ocultar pedidos" : "Asociar pedidos de compra"}
                </button>
                {poMsg && <p className={poMsg.startsWith("Proveedor verificado") || poMsg.startsWith("Pedidos asociados") || poMsg.startsWith("Raskibot propone") || poMsg.startsWith("La lista de pedidos") ? "si-msg" : "error"} role="status">{poMsg}</p>}
                {poOpen && (
                  <div className="si-multipo">
                    {poCandidates.length === 0 ? (
                      <>
                        <p className="si-note">No hay pedidos sin factura de este proveedor.</p>
                        {invoiceBranch === "services" && <button className="si-editor-add" type="button" disabled={poSaving || poLoading || !confirmedPartnerId && !doc.confirmedOdooPartnerId} onClick={() => void savePoLink()}>
                          {poSaving ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />} {poSaving ? "Verificando proveedor…" : "Confirmar proveedor y rama de servicios"}
                        </button>}
                      </>
                    ) : (
                      <>
                        <div className="si-pick">
                          <span>Seleccionados: <b>{selectedPoIds.length}</b> pedido(s)</span>
                        <button className="si-editor-add" disabled={poSaving || poLoading || !confirmedPartnerId && !doc.confirmedOdooPartnerId} onClick={() => void savePoLink()} type="button">
                          {poSaving ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />} {poSaving ? "Revalidando y cotejando…" : "Guardar proveedor y pedidos"}
                          </button>
                        </div>
                        <table>
                          <thead>
                            <tr><th></th><th>Pedido</th><th>Fecha</th><th>Total</th><th>Facturado</th><th>Pendiente</th></tr>
                          </thead>
                          <tbody>
                            {poCandidates.map((po) => (
                              <tr key={po.id}>
                                <td><input type="checkbox" checked={selectedPoIds.includes(po.id)} onChange={() => togglePo(po.id)} aria-label={`Seleccionar ${po.name}`} /></td>
                                <td><b>{po.name}</b>{po.allReceived ? " · recibido" : " · parcial"}{po.supplierRef ? <small> · Ref. proveedor: {po.supplierRef}</small> : null}{po.origin ? <small> · Origen: {po.origin}</small> : null}</td>
                                <td>{po.dateOrder ?? "—"}</td>
                                <td className="qty-cell">{money(po.amountTotal, po.currency ?? "EUR")}</td>
                                <td className="qty-cell">{po.billedPct.toFixed(0)}%</td>
                                <td className="qty-cell">{money(po.pendingAmount, po.currency ?? "EUR")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                )}
              </section>
            )}

            {!isExcluded && Boolean(doc.odooDraftMoveId) && (
              <section className="si-drive-section">
                <h3>Guardar en Drive</h3>
                {doc.movedTo ? (
                  <p className="si-msg"><CheckCircle2 size={14} /> PDF ya archivado en {doc.targetFolderPath ?? doc.movedTo}.</p>
                ) : (
                  <>
                    <p className="si-note">Navega dentro de FACTURAS, elige una carpeta existente o crea una nueva. El PDF solo se moverá al pulsar «Guardar PDF aquí».</p>
                    <button className="si-editor-add" onClick={() => void openDrive()} type="button" disabled={driveLoading || creatingFolder || moving}>
                      {driveLoading ? <RefreshCw className="spin" size={14} /> : <Folder size={14} />} {driveLoading ? "Cargando carpetas…" : driveOpen ? "Ocultar navegador" : "Abrir navegador de Drive"}
                    </button>
                    {driveMsg && <p className={driveMsg.startsWith("PDF guardado") || driveMsg.startsWith("Carpeta creada") || driveMsg.startsWith("Destino seleccionado") ? "si-msg" : "error"} role="status">{driveMsg}</p>}
                    {driveOpen && (
                      <div className="si-drive-nav">
                        <div className="si-drive-crumb">
                          <button type="button" onClick={() => void goUp()} disabled={!drivePath.length || driveLoading} title="Subir un nivel"><ChevronLeft size={14} /></button>
                          <span>FACTURAS{drivePath.map((c) => ` / ${c.name}`).join("")}</span>
                        </div>
                        <input className="si-drive-filter" value={driveFilter} onChange={(e) => setDriveFilter(e.target.value)} placeholder="Buscar carpeta en este nivel…" aria-label="Buscar carpeta en este nivel" />
                        <ul className="si-drive-folders">
                          {driveLoading && <li className="si-note">Cargando…</li>}
                          {!driveLoading && driveFolders.length === 0 && <li className="si-note">Sin subcarpetas aquí.</li>}
                          {!driveLoading && driveFolders.length > 0 && !driveFolders.some((f) => f.name.toLocaleLowerCase("es").includes(driveFilter.toLocaleLowerCase("es"))) && <li className="si-note">No hay carpetas con ese nombre en este nivel.</li>}
                          {driveFolders.filter((f) => f.name.toLocaleLowerCase("es").includes(driveFilter.toLocaleLowerCase("es"))).map((f) => (
                            <li key={f.id}>
                              <button type="button" disabled={driveLoading || creatingFolder || moving} onClick={() => void enterFolder(f)}>
                                <Folder size={14} /> {f.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                        <div className="si-drive-newfolder">
                          <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} disabled={creatingFolder || driveLoading || moving} placeholder="Nueva carpeta aquí…" aria-label="Nombre de nueva carpeta" />
                          <button type="button" disabled={creatingFolder || driveLoading || moving || !newFolderName.trim()} onClick={() => void createFolderHere()}>
                            {creatingFolder ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />} {creatingFolder ? "Creando…" : "Crear carpeta"}
                          </button>
                        </div>
                        <div className="si-pick">
                          <button className="si-editor-add" type="button" disabled={driveLoading || creatingFolder || moving || !drivePath.length} onClick={selectCurrentFolder}>Usar carpeta actual</button>
                          <button className="si-editor-add" type="button" disabled={!driveTarget || driveLoading || creatingFolder || moving} onClick={() => void movePdf()}>
                            {moving ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />} {moving ? "Guardando PDF…" : "Guardar PDF aquí"}
                          </button>
                        </div>
                        {driveTarget && <p className="si-note">Destino seleccionado: <b>{driveTarget.path}</b></p>}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            <section>
              <h3>Lista de productos para cotejar {lines.length ? `(${lines.length})` : ""}</h3>
              <div className="si-product-editor">
                <button className="si-editor-add" onClick={() => { setLinkingLineIndex(null); setPickerOpen((v) => !v); if (!catalog.length) void loadCatalog(); }} type="button">
                  {catalogLoading ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />} Editar productos
                </button>
                <button className="si-editor-add" onClick={applyWebAdjustment} disabled={!webAdjustmentPreview || webAdjustmentPreview.amount === 0 || !!doc.odooDraftMoveId} type="button">
                  <Plus size={14} /> Añadir Ajuste Web sin IVA {webAdjustmentPreview && webAdjustmentPreview.amount !== 0 ? `(${money(webAdjustmentPreview.amount, ex?.currency ?? "EUR")})` : ""}
                </button>
                {webAdjustmentPreview ? <p className="si-note" role="status">Propuesta de ajuste basada en la extracción IA del PDF: PDF {money(Number(fields.base), ex?.currency ?? "EUR")} − productos {money(webAdjustmentPreview.productsBase, ex?.currency ?? "EUR")} = Ajuste Web {money(webAdjustmentPreview.amount, ex?.currency ?? "EUR")}. Revísala y añádela solo si corresponde. IVA pendiente de cotejo: {money(webAdjustmentPreview.taxDifference, ex?.currency ?? "EUR")}.</p> : <p className="si-note">{webAdjustmentError}</p>}
                {webAdjustmentPreview && webAdjustmentPreview.taxDifference !== 0 && lines.some((line) => isWebAdjustmentProductId(line.productId)) && <button className="si-editor-add" type="button" disabled={!!doc.odooDraftMoveId} onClick={() => applyTaxTotal(fields.taxes)}><Plus size={14} /> Cuadrar IVA con PDF ({money(webAdjustmentPreview.taxDifference, ex?.currency ?? "EUR")})</button>}
                <p className="si-note">El ajuste usa el producto Odoo AJUSTEWEB sin IVA. Si queda diferencia de IVA, revisa las cuotas antes de pulsar «Cuadrar IVA con PDF»; esta acción la aplica a las líneas gravadas y muestra el resultado para guardar y validar.</p>
                <div className="si-fiscal-bulk" aria-label="Descuentos sucesivos de la factura">
                  <b>Descuentos sucesivos sobre las líneas (después del DTO principal)</b>
                  <label>Extra % <input aria-label="Descuento extra" type="number" min="0" max="100" step="0.001" value={bulkExtraDiscount} onChange={(event) => setBulkExtraDiscount(event.target.value)} /></label>
                  <label>Pronto pago % <input aria-label="Descuento por pronto pago" type="number" min="0" max="100" step="0.001" value={bulkPromptDiscount} onChange={(event) => setBulkPromptDiscount(event.target.value)} /></label>
                  <button className="si-editor-add" type="button" onClick={applySequentialDiscounts}>Aplicar descuentos y recalcular IVA</button>
                </div>
                <p className="si-note">Los porcentajes se aplican uno tras otro (45% + 5% + 2% → descuento efectivo 48,795%). Odoo recibirá el mismo descuento efectivo por línea; compara siempre el resultado con el PDF.</p>
                <div className="si-fiscal-bulk" aria-label="IVA y cuenta contable del proveedor">
                  <b>IVA y cuenta del proveedor</b>
                  <select aria-label="IVA predeterminado" value={bulkTaxId ?? ""} onChange={(e) => setBulkTaxId(e.target.value ? Number(e.target.value) : null)}><option value="">IVA…</option>{taxOptions.map((tax) => <option key={tax.id} value={tax.id}>{tax.name}</option>)}</select>
                  <select aria-label="Cuenta predeterminada" value={bulkAccountId ?? ""} onChange={(e) => setBulkAccountId(e.target.value ? Number(e.target.value) : null)}><option value="">Cuenta…</option>{accountOptions.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select>
                  <button className="si-editor-add" type="button" onClick={applyFiscalDefaults}>Aplicar a todas</button>
                </div>
                {pickerOpen && (
                  <div className="si-product-picker">
                    <label>{linkingLineIndex !== null ? "Enlazar esta línea con un producto existente de Odoo" : "Buscar en el catálogo de Odoo (no almacenables incluidos)"}
                      <input autoFocus aria-autocomplete="list" aria-controls="si-product-suggestions"
                        onChange={(e) => setTerm(e.target.value)}
                        onKeyDown={(event) => { if (event.key === "Enter" && results[0]) { event.preventDefault(); addProduct(results[0]); } }}
                        placeholder="Escribe nombre, referencia o EAN" value={term} />
                    </label>
                    {catalogLoading && <span role="status">Buscando productos…</span>}
                    {serviceLoading && <span role="status">Consultando servicios activos en Odoo…</span>}
                    {serviceError && <span className="error" role="alert">{serviceError}</span>}
                    {catalogError && <span className="error" role="alert">{catalogError}</span>}
                    {!catalogLoading && !catalogError && normalizedTerm && results.length === 0 && <span>No hay productos que coincidan con «{term.trim()}».</span>}
                    <ul id="si-product-suggestions" className="si-product-suggestions" role="listbox">
                      {results.map((product, index) => (
                        <li key={product.id} role="option">
                          <button type="button" onClick={() => addProduct(product)}>
                            <strong>{product.reference || "Sin referencia"} · {product.name}</strong>
                            <small>{product.type === "service" ? "Servicio" : product.type === "consu" ? "Consumible" : "Producto"} · EAN {product.barcode || "sin EAN"}{index === 0 && normalizedTerm ? " · INTRO para seleccionar" : ""}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {lines.length > 0 && (
                  <div className="si-editor-lines">
                    <div className="si-editor-line-header" style={{ gridTemplateColumns: lineGridTemplate }}>
                      {invoiceLineColumns.map((column) => <span className="si-editor-column-heading" key={column.id} title={column.label}>
                        {column.label}
                        {column.id !== "remove" && <button type="button" className="si-editor-column-resizer" aria-label={`Ajustar columna ${column.label}`} onPointerDown={(event) => startLineColumnResize(event, column.id)} />}
                      </span>)}
                    </div>
                    {lines.map((l, i) => {
                      const availableReceived = l.qtyReceived == null ? null : Math.max(0, l.qtyReceived - (l.qtyInvoiced ?? 0));
                      const currentInvoiceOverReceipt = invoiceBranch === "goods" && availableReceived != null && l.quantity != null && Math.abs(l.quantity - availableReceived) > 0.0001;
                      return (
                      <div className={`si-editor-line${currentInvoiceOverReceipt ? " si-qty-mismatch" : ""}`} key={i} style={{ gridTemplateColumns: lineGridTemplate }}>
                        <div className="si-editor-product">{l.productId ? <a className="si-product-odoo-link" href={`${apiPath}/product-odoo?id=${l.productId}`} target="_blank" rel="noopener noreferrer" title="Abrir producto en Odoo" aria-label={`Abrir ${l.description} en Odoo`}><Search size={14} /></a> : null}<div><label className="si-editor-field"><span>{invoiceBranch === "services" ? "Descripción contable" : "Producto / descripción"}</span><input value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} /></label><span className="si-line-origin">{l.sourcePurchaseOrderName || (l.genericProductConfirmed ? "Servicio/consumible confirmado" : invoiceBranch === "services" ? "Servicio sin pedido · producto opcional" : "Línea manual · sin producto Odoo; requiere cuenta e IVA")}<small>{l.productId && l.sourcePurchaseOrderId ? `Producto Odoo #${l.productId}: ${poCandidates.find((order) => order.id === l.sourcePurchaseOrderId)?.lines.find((source) => source.productId === l.productId)?.productName ?? "comprueba el pedido"} · ` : ""}Pedida: {l.qtyOrdered ?? "—"} · Recibida: {l.qtyReceived ?? "—"} · Fact. previa: {l.qtyInvoiced ?? "—"} · Esta factura: {l.quantity ?? "—"} · Pendiente: {l.qtyPending ?? "—"}</small>{currentInvoiceOverReceipt && <small className="si-qty-mismatch-note" role="alert">La cantidad de esta factura ({l.quantity}) no coincide con lo recibido pendiente de facturar ({availableReceived}); revisa esta línea.</small>}{l.matchCandidates?.length ? <small className="si-match-candidates">{l.matchCandidates.some((candidate) => candidate.identityLevel === "ambiguous") ? "Coincidencia ambigua" : l.matchCandidates.some((candidate) => candidate.identityLevel === "exact") ? "Identidad exacta" : "Candidatos probables"}: {l.matchCandidates.map((candidate) => `${candidate.purchaseOrderName} · ${candidate.productName} (${candidate.score}%, ${candidate.evidence.join("/") || "nombre aproximado"}${candidate.discrepancies.length ? `; revisar ${candidate.discrepancies.join(", ")}` : ""})`).join(" · ")}. Requiere revisión humana; no está asociado.</small> : null}{doc.pdfSourceLines?.[i]?.reference === l.reference && doc.pdfSourceLines?.[i]?.description === l.description && doc.pdfSourceLines?.[i]?.priceUnit != null && l.priceUnit != null && Math.abs(doc.pdfSourceLines[i].priceUnit! - l.priceUnit) > 0.000001 ? <small>Precio impreso en PDF: {doc.pdfSourceLines[i].priceUnit!.toLocaleString("es-ES", { maximumFractionDigits: 5 })} € · ajuste del borrador: {l.priceUnit.toLocaleString("es-ES", { maximumFractionDigits: 5 })} €</small> : null}{!l.productId ? <button className="si-link-product" type="button" onClick={() => { setLinkingLineIndex(i); setPickerOpen(true); if (!catalog.length) void loadCatalog(); }}>Enlazar producto Odoo</button> : null}{l.aiProductCandidateId && l.aiProductCandidateId !== l.productId ? <><small>Raskibot encontró un producto por referencia exacta; sigue sin estar seleccionado{l.aiCandidateReason ? ` · ${l.aiCandidateReason}` : ""}.</small><button className="si-link-product" type="button" disabled={applyingSuggestion !== null || saving || savingFields} aria-label={`Revisar y seleccionar el producto sugerido ${l.aiProductCandidateId} para ${l.description}`} onClick={() => void acceptRaskibotProductCandidate(i, Number(l.aiProductCandidateId))}>{applyingSuggestion === i ? <><RefreshCw className="spin" size={14} /> Comprobando referencia en Odoo…</> : `Revisar candidato Odoo #${l.aiProductCandidateId}`}</button></> : null}{productSuggestions[i] && productSuggestions[i]?.productId !== l.productId ? <button className="si-link-product" type="button" disabled={applyingSuggestion !== null} onClick={() => void acceptProductSuggestion(i, productSuggestions[i]!)}>{applyingSuggestion === i ? <><RefreshCw className="spin" size={14} /> Comprobando en Odoo…</> : `Sugerencia aprendida: producto #${productSuggestions[i]?.productId} · revisar y elegir`}</button> : null}</span>
                          {invoiceBranch === "goods" && l.productId && !l.sourcePurchaseOrderId && !(doc.assignedPurchaseOrderIds ?? []).some((id) => poCandidates.find((order) => order.id === id)?.lines.some((source) => source.productId === l.productId)) && <><small className="error">Este producto no figura en las líneas de los pedidos asociados.</small><button className="si-link-product" type="button" onClick={() => updateLine(i, { productId: null, sourcePurchaseOrderId: null, sourcePurchaseOrderName: null, qtyOrdered: null, qtyReceived: null, qtyInvoiced: null, qtyPending: null, genericProductConfirmed: false, pdfPriceVerified: false })}>Dejar como línea manual sin producto</button></>}
                        </div></div>
                        <label className="si-editor-field"><span>Cant.</span><input type="number" min="0" step="any" value={l.quantity ?? ""} onChange={(e) => updateLine(i, { quantity: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                        <label className="si-editor-field"><span>Precio Uds</span><input type="number" min="0" step="0.00001" value={l.priceUnit ?? ""} onChange={(e) => updateLine(i, { priceUnit: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                        <label className="si-editor-field"><span>DTO</span><input type="number" min="0" max="100" step="0.01" value={l.discount ?? ""} onChange={(e) => updateLine(i, { discount: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                        <label className="si-editor-field"><span>DTO extra</span><input type="number" min="0" max="100" step="0.001" value={l.discountExtra ?? ""} onChange={(e) => updateLine(i, { discountExtra: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                        <label className="si-editor-field"><span>Pronto pago</span><input type="number" min="0" max="100" step="0.001" value={l.promptPaymentDiscount ?? ""} onChange={(e) => updateLine(i, { promptPaymentDiscount: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                        <label className="si-editor-field"><span>IVA</span><select value={l.taxId ?? ""} onChange={(e) => {
                          const tax = taxOptions.find((item) => item.id === Number(e.target.value));
                          updateLine(i, tax ? { taxId: tax.id, taxRate: tax.type === "percent" ? tax.rate : null, taxNames: [tax.name] } : { taxId: null, taxRate: null, taxNames: [] });
                        }}>
                          <option value="">Sin impuesto</option>
                          {taxOptions.map((tax) => <option key={tax.id} value={tax.id}>{tax.name}{tax.type === "percent" ? ` · ${tax.rate}%` : ""}</option>)}
                        </select></label>
                        <label className="si-editor-field"><span>Imp.</span><input type="number" min="0" step="0.01" value={l.taxAmount ?? ""} onChange={(e) => updateLine(i, { taxAmount: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                        <label className="si-editor-field si-editor-account"><span>Cuenta</span><select value={l.accountId ?? ""} onChange={(e) => {
                          const account = accountOptions.find((item) => item.id === Number(e.target.value));
                          updateLine(i, account ? { accountId: account.id, accountName: `${account.code} · ${account.name}` } : { accountId: null, accountName: null });
                        }}>
                          <option value="">Cuenta contable…</option>
                          {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
                        </select></label>
                        <label className="si-editor-field"><span>Sin IVA</span><input type="number" min="0" step="0.01" value={l.total ?? ""} onChange={(e) => updateLine(i, { total: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                        <label className="si-editor-field si-editor-total"><span>Con IVA</span><input type="number" min="0" step="0.01" value={l.totalWithTax ?? (l.total != null ? Math.round((l.total + (l.taxAmount ?? 0)) * 100) / 100 : "")} onChange={(e) => updateLine(i, { totalWithTax: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                        <button className="si-remove-line" aria-label="Quitar línea" title="Quitar línea" onClick={() => removeLine(i)} type="button"><Trash2 size={14} /></button>
                      </div>
                      );
                    })}
                  </div>
                )}
                {lines.length > 0 && (
                  <div className="si-lines-totals">
                    {(() => {
                      const baseSum = lines.reduce((acc, l) => acc + (l.total ?? discountedBase(l.quantity ?? 0, l.priceUnit ?? 0, l.discount, l.discountExtra, l.promptPaymentDiscount)), 0);
                      const taxSum = lines.reduce((acc, l) => acc + (l.taxAmount ?? 0), 0);
                      const sum = lines.reduce((acc, l) => acc + (l.totalWithTax ?? ((l.total ?? 0) + (l.taxAmount ?? 0))), 0);
                      const declared = fields.total !== "" ? Number(fields.total) : null;
                      return (
                        <>
                          <span>Base total: <b>{money(baseSum, ex?.currency ?? "EUR")}</b></span>
                          <label>Impuesto total <input aria-label="Impuesto total" type="number" min="0" step="0.01" value={taxTotalEdit ?? taxSum.toFixed(2)} onFocus={() => setTaxTotalEdit(taxSum.toFixed(2))} onChange={(e) => setTaxTotalEdit(e.target.value)} onBlur={(e) => { if (taxTotalEdit !== null && taxTotalEdit !== taxSum.toFixed(2)) applyTaxTotal(e.target.value); else setTaxTotalEdit(null); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>
                          <span>Total con IVA: <b>{money(sum, ex?.currency ?? "EUR")}</b></span>
                          {declared != null && Math.abs(declared - sum) > 0.005 && (
                            <small>El total declarado difiere: {money(declared, ex?.currency ?? "EUR")}</small>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
                {lines.length > 0 && (
                  <button className="si-editor-add" disabled={saving || savingFields} onClick={() => void saveLinesLocal()} type="button">
                    {saving ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />} {saving ? "Guardando líneas…" : "Guardar líneas"}
                  </button>
                )}
                {saveMsg && <p className={saveMsg.startsWith("Líneas") || saveMsg.startsWith("Descuentos sucesivos") || saveMsg.startsWith("Ajuste Web sin impuestos preparado") ? "si-msg" : "error"} role="status">{saveMsg}</p>}
                {optionError && <p className="error" role="alert">{optionError}</p>}
                <p className="si-note">«Guardar líneas» solo guarda en el LAB. «Validar y revisar borrador Odoo» abre la confirmación; el borrador se crea solo si después pulsas «Aceptar y crear borrador».</p>
              </div>
            </section>

            {!isExcluded && (
              <section>
                <h3>Factura en Odoo</h3>
                {doc.odooDraftMoveId ? (
                  <div className="si-odoo-state">
                    <p className="si-msg"><CheckCircle2 size={14} /> Borrador creado en Odoo · ID <b>{doc.odooDraftMoveId}</b> · ref. proveedor <b>{ex?.invoiceNumber ?? "—"}</b> · estado: {doc.odooDraftState ?? "draft"}</p>
                    <a className="si-odoo-draft-link" href={`${apiPath}/odoo-draft-open?id=${encodeURIComponent(doc.driveFileId)}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Abrir borrador en Odoo</a>
                    {doc.odooDraftActual && <><p>Odoo: base {money(doc.odooDraftActual.base, "EUR")} · IVA {money(doc.odooDraftActual.taxes, "EUR")} · total {money(doc.odooDraftActual.total, "EUR")}. PDF: {ex?.total != null ? money(ex.total, "EUR") : "—"}.</p>
                      {doc.odooDraftActual.dueDate && <p>Vencimiento en Odoo: <b>{doc.odooDraftActual.dueDate}</b>.</p>}
                      <div className="si-draft-confirm-scroll"><table><thead><tr><th>Producto Odoo</th><th>Línea de compra</th><th>Cantidad</th><th>Precio</th><th>Base Odoo</th><th>Total Odoo</th></tr></thead><tbody>{doc.odooDraftActual.lines.map((line, index) => <tr key={index}><td>{line.productId ?? "—"}</td><td>{line.purchaseLineId ?? "—"}</td><td>{line.quantity}</td><td>{line.priceUnit.toFixed(3)}</td><td>{money(line.base, "EUR")}</td><td>{money(line.total, "EUR")}</td></tr>)}</tbody></table></div>
                    </>}
                    {doc.odooDraftState === "posted" ? <p className="si-msg"><CheckCircle2 size={14} /> Factura contabilizada en Odoo.</p> : <p className="si-note">Revisa y valida este borrador directamente en Odoo. Dashboard no contabiliza facturas.</p>}
                  </div>
                ) : (
                  <>
                    <p className="si-note">Este paso comprueba el cotejo y muestra una confirmación con el cálculo previsto por línea. Sólo «Aceptar y crear borrador» escribe en Odoo.</p>
                    <button className="si-editor-add" disabled={odooBusy || validatingDraft || saving || savingFields} onClick={() => void validateAndReviewDraft()} type="button">
                      {validatingDraft ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />} {validatingDraft ? "Validando factura…" : "Validar y revisar borrador Odoo"}
                    </button>
                  </>
                )}
                {odooMsg && <p className={odooMsg.startsWith("Borrador") || odooMsg.startsWith("Factura") ? "si-msg" : "error"} role="status">{odooMsg}</p>}
              </section>
            )}

            {draftConfirmation && <div className="si-draft-confirm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !odooBusy) setDraftConfirmation(false); }}>
              <div className="si-draft-confirm" role="dialog" aria-modal="true" aria-labelledby="si-draft-confirm-title" aria-busy={odooBusy}>
                <h3 id="si-draft-confirm-title">¿Quieres crear el borrador en Odoo?</h3>
                <p>Referencia del proveedor: <b>{doc.extracted?.invoiceNumber || "Sin número"}</b> · {doc.extracted?.supplier || "Sin proveedor"} · Pedidos: {(doc.assignedPurchaseOrderIds ?? []).join(", ") || "ninguno"}</p>
                <p>Vencimiento que se enviará a Odoo: <b>{doc.extracted?.dueDate || "No detectado"}</b>. {doc.extracted?.dueDate ? "Comprueba que coincide con el PDF." : "Revisa el campo Vencimiento del editor antes de crear el borrador."}</p>
                <p>Previsión por líneas con precios a 3 decimales. Odoo hará su propio cálculo fiscal; revisa el resultado antes de contabilizar.</p>
                <div className="si-draft-confirm-scroll"><table><thead><tr><th>Pedido · producto</th><th>Cant.</th><th>Precio</th><th>Base prevista</th><th>IVA previsto</th></tr></thead><tbody>
                  {projectedLines.map(({ line, base, tax }, i) => <tr key={i}><td>{line.sourcePurchaseOrderName || "Sin pedido"} · {line.description}</td><td>{line.quantity ?? "—"}</td><td>{line.priceUnit?.toFixed(3) ?? "—"}</td><td>{base.toFixed(2)} €</td><td>{tax?.toFixed(2) ?? "—"} €</td></tr>)}
                </tbody></table></div>
                <p>PDF: {doc.extracted?.base ?? "—"} € + {doc.extracted?.taxes ?? "—"} € = {doc.extracted?.total ?? "—"} € · Previsión Odoo: {projectedBase.toFixed(2)} € + {projectedTax.toFixed(2)} € = {(projectedBase + projectedTax).toFixed(2)} €.</p>
                <label>Fecha contable / creación del borrador <input type="date" required value={accountingDate} onChange={(e) => setAccountingDate(e.target.value)} /></label>
                {amountReviewWarnings.length > 0 && <p className="si-warn" role="alert"><b>Hay diferencias de importes.</b> Se podrá crear el borrador para revisarlo en Odoo; comprueba los importes antes de contabilizar. {amountReviewWarnings.join(" · ")}</p>}
                {!draftWriteEnabled && <p className="si-warn" role="status">{draftCapabilityChecking ? "Comprobando permiso para crear el borrador…" : draftCapabilityError || "El LAB está en solo lectura: el botón Aceptar está deshabilitado. El permiso se comprueba de nuevo automáticamente; la previsualización no modifica Odoo."}</p>}
                {odooMsg && <p className="error" role="alert">{odooMsg}</p>}
                <div className="si-draft-confirm-actions"><button type="button" disabled={odooBusy} onClick={() => setDraftConfirmation(false)}>Cancelar</button><button type="button" className="si-primary" disabled={odooBusy || !accountingDate || !draftWriteEnabled} onClick={() => void createOdooDraft()}>{odooBusy ? <><RefreshCw className="spin" size={14}/> Enviando a Odoo…</> : "Aceptar y crear borrador"}</button></div>
              </div>
            </div>}
            {draftCreated && <div className="si-draft-confirm-backdrop">
              <div className="si-draft-confirm" role="dialog" aria-modal="true" aria-labelledby="si-draft-created-title">
                <h3 id="si-draft-created-title"><CheckCircle2 size={20} /> Borrador creado en Odoo</h3>
                <p>Factura de proveedor <b>{draftCreated.reference || "—"}</b> · ID de Odoo <b>{draftCreated.id}</b>.</p>
                {draftCreated.dueDate && <p>Vencimiento guardado en Odoo: <b>{draftCreated.dueDate}</b>.</p>}
                {draftCreated.total != null && <p>Total calculado por Odoo: <b>{money(draftCreated.total, "EUR")}</b>. Total del PDF: <b>{doc.extracted?.total != null ? money(doc.extracted.total, "EUR") : "—"}</b>.</p>}
                <p className="si-note">El número contable todavía no está asignado: Odoo muestra «/» mientras la factura está en borrador. Revisa y valida la factura directamente en Odoo.</p>
                <div className="si-draft-confirm-actions"><a className="si-odoo-draft-link" href={`${apiPath}/odoo-draft-open?id=${encodeURIComponent(doc.driveFileId)}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Abrir borrador en Odoo</a><button type="button" className="si-primary" onClick={() => setDraftCreated(null)}>Entendido</button></div>
              </div>
            </div>}
          </div>
        </div>
      </aside>
    </div>
  );
}

export function UnbilledView({ base }: { base: string }) {
  const api = (s: string) => base + s;
  const [data, setData] = useState<UnbilledData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);
  const [draft, setDraft] = useState<F>({ status: "", partner: "", country: "", received: "", over15: "", text: "" });
  const [filters, setFilters] = useState<F>({ status: "", partner: "", country: "", received: "", over15: "", text: "" });

  const qs = useMemo(() => {
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
    q.set("pageSize", "50");
    return q.toString();
  }, [filters]);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(api(`/api/odoo/supplier-invoices/unbilled?${qs}`));
      const x = await r.json();
      if (!r.ok) throw Error(x.message);
      setData(x);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error leyendo pedidos");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [qs]);

  const sync = async () => {
    setSyncing(true);
    setMsg("");
    try {
      const r = await fetch(api("/api/odoo/supplier-invoices/unbilled/sync"), { method: "POST" });
      const x = await r.json();
      if (!r.ok) throw Error(x.message);
      setMsg(`Sincronizados ${x.meta?.totalOrders ?? 0} pedidos desde Odoo (últimos 24 meses)`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo sincronizar");
    } finally {
      setSyncing(false);
    }
  };

  if (!data && loading)
    return (
      <section className="si-loading">
        <RefreshCw className="spin" /> Cargando pedidos sin facturar…
      </section>
    );

  const k = data?.kpis;
  const kpiCards = [
    { label: "Pedidos sin factura", value: k?.ordersWithoutInvoice.count ?? 0, detail: money(k?.ordersWithoutInvoice.total ?? 0), tone: "warn" },
    { label: "Facturación parcial", value: k?.partialBilling.count ?? 0, detail: `Pendiente ${money(k?.partialBilling.pending ?? 0)}`, tone: "warn" },
    { label: "Recibidos >15 días sin factura", value: k?.receivedOver15Days.count ?? 0, detail: "acción: contactar proveedor", tone: "danger" },
    { label: "Importaciones", value: k?.importaciones.count ?? 0, detail: money(k?.importaciones.total ?? 0), tone: "" },
    { label: "Importe total pendiente", value: money(k?.totalPendingAmount ?? 0), detail: `${k?.totalOrders ?? 0} pedidos en control`, tone: "" },
  ];

  return (
    <section className="si-phase2">
      <header className="si-head">
        <div>
          <p className="eyebrow">Compras / Facturas de proveedor</p>
          <h2>Pedidos sin facturar</h2>
          <p>Fase 2 · Control pedido / recepción / factura · datos reales de Odoo (solo lectura)</p>
        </div>
        <div className="si-actions">
          <small>{data?.poFreshness?.stale ? "DATOS DESACTUALIZADOS · " : ""}Última sync: {dt(data?.lastPoSyncAt?.slice(0, 10) ?? null)}</small>
          <button className="si-primary" disabled={syncing} onClick={() => void sync()}>
            {syncing ? <RefreshCw className="spin" /> : <ShoppingCart />}
            {syncing ? "Sincronizando…" : "Sincronizar pedidos"}
          </button>
        </div>
      </header>
      {msg && <p className="si-msg" role="status">{msg}</p>}

      <section className="si-kpis">
        {kpiCards.map((c) => (
          <article key={c.label} className={c.tone ? `kpi-${c.tone}` : ""}>
            <span>{c.label}</span>
            <strong>{c.value}</strong>
            <small>{c.detail}</small>
          </article>
        ))}
      </section>

      <section className="si-filters">
        <div className="si-filter-title"><Filter /> <b>Filtros</b></div>
        <div className="si-filter-grid">
          <label className="si-field">
            <span>Estado</span>
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">Todos</option>
              {Object.entries(PO_STATUS_ES).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </label>
          <label className="si-field">
            <span>Recepción</span>
            <select value={draft.received} onChange={(e) => setDraft({ ...draft, received: e.target.value })}>
              <option value="">Todas</option>
              <option value="si">Recibido</option>
              <option value="no">Pendiente</option>
            </select>
          </label>
          <label className="si-field">
            <span>Proveedor</span>
            <input value={draft.partner} onChange={(e) => setDraft({ ...draft, partner: e.target.value })} placeholder="Nombre exacto…" />
          </label>
          <label className="si-field">
            <span>País</span>
            <input value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} placeholder="España…" />
          </label>
          <label className="si-search">
            <span>Buscar</span>
            <Search size={15} />
            <input value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="Pedido, proveedor, origen…" />
          </label>
          <div className="si-filter-buttons">
            <button className="si-primary" onClick={() => setFilters(draft)}>Aplicar</button>
            <button onClick={() => { const empty = { status: "", partner: "", country: "", received: "", over15: "", text: "" }; setDraft(empty as F); setFilters(empty as F); }}>Limpiar</button>
          </div>
        </div>
      </section>

      <div className="si-table si-table-po">
        <table>
          <thead>
            <tr>
              <th>Pedido</th><th>Proveedor</th><th>País</th><th>Fecha pedido</th><th>Importe</th>
              <th>Estado</th><th>Recepción</th><th>% Facturado</th><th>Días s/factura</th><th>Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10}>Actualizando…</td></tr>
            ) : !data?.items.length ? (
              <tr><td colSpan={10}>Sin pedidos pendientes. Pulsa «Sincronizar pedidos» para traer los últimos 24 meses desde Odoo.</td></tr>
            ) : (
              data.items.map((o) => (
                <tr key={o.id} onClick={() => setSelected(o)}>
                  <td><b>{o.name}</b>{o.supplierRef ? <small>Ref. proveedor: {o.supplierRef}</small> : null}</td>
                  <td>{o.partnerName}</td>
                  <td>{o.partnerCountry || "—"}</td>
                  <td>{dt(o.dateOrder)}</td>
                  <td><b>{money(o.amountTotal, o.currency ?? "EUR")}</b></td>
                  <td><span className={`si-badge po-${o.status}`}>{PO_STATUS_ES[o.status] ?? o.status}</span></td>
                  <td>
                    {o.pickings.length
                      ? o.pickings.map((p) => (
                          <small key={p.name} className={p.state === "done" ? "po-done" : "po-pending"}>
                            {p.name} {p.state === "done" ? "✓" : "…"}
                          </small>
                        ))
                      : "—"}
                  </td>
                  <td>
                    <span className={`si-pct ${o.billedPct === 0 ? "bad" : o.billedPct !== null && o.billedPct < 100 ? "warn" : "ok"}`}>
                      {o.billedPct != null ? `${o.billedPct.toFixed(0)}%` : "0%"}
                    </span>
                  </td>
                  <td>{o.daysSinceReception ?? "—"}</td>
                  <td>{money(o.pendingAmount, o.currency ?? "EUR")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && <PoDetail order={selected} close={() => setSelected(null)} />}
    </section>
  );
}

function PoDetail({ order, close }: { order: Order; close: () => void }) {
  const steps = [
    { label: "Pedido confirmado", ok: order.state === "purchase" || order.state === "done" },
    { label: "Recepción", ok: order.allReceived },
    { label: "Factura proveedor", ok: order.status === "FACTURADO" },
  ];
  return (
    <div className="si-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside className="si-drawer">
        <button className="si-close" onClick={close}><X /></button>
        <p className="eyebrow">Pedido de compra</p>
        <h2>{order.name}</h2>
        <span className={`si-badge po-${order.status}`}>{PO_STATUS_ES[order.status] ?? order.status}</span>

        <section>
          <h3>Flujo pedido → recepción → factura</h3>
          <ol className="si-steps">
            {steps.map((s) => (
              <li key={s.label} className={s.ok ? "ok" : "bad"}>
                {s.ok ? <CheckCircle2 size={14} /> : <X size={14} />} {s.label}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h3>Datos generales</h3>
          <dl>
            <div><dt>Proveedor</dt><dd>{order.partnerName}</dd></div>
            <div><dt>País</dt><dd>{order.partnerCountry || "—"}</dd></div>
            <div><dt>Fecha pedido</dt><dd>{dt(order.dateOrder)}</dd></div>
            <div><dt>Comprador</dt><dd>{order.buyer || "—"}</dd></div>
            <div><dt>Origen</dt><dd>{order.origin || "—"}</dd></div>
            <div><dt>Referencia proveedor</dt><dd>{order.supplierRef || "—"}</dd></div>
            <div><dt>Importe</dt><dd><b>{money(order.amountTotal, order.currency ?? "EUR")}</b></dd></div>
            <div><dt>Facturado</dt><dd>{money(order.billedAmount, order.currency ?? "EUR")} ({order.billedPct?.toFixed(0) ?? 0}%)</dd></div>
            <div><dt>Pendiente de facturar</dt><dd>{money(order.pendingAmount, order.currency ?? "EUR")}</dd></div>
            {order.billingSplit && <div><dt>Nota</dt><dd>Una factura agrupa varios pedidos; el reparto es proporcional al importe.</dd></div>}
            {order.linkedInvoiceNames.length > 0 && <div><dt>Facturas</dt><dd>{order.linkedInvoiceNames.join(", ")}</dd></div>}
            <div><dt>Última recepción</dt><dd>{dt(order.lastReceptionAt?.slice(0, 10) ?? null)} {order.daysSinceReception != null ? `· hace ${order.daysSinceReception} días` : ""}</dd></div>
          </dl>
        </section>

        <section>
          <h3>Líneas del pedido</h3>
          <div className="si-table si-po-lines">
            <table>
              <thead>
                <tr><th>Producto</th><th>Pedida</th><th>Recibida</th><th>Facturada</th><th>Pendiente</th><th>Precio</th></tr>
              </thead>
              <tbody>
                {order.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.productName || "—"}</td>
                    <td>{l.qtyOrdered}</td>
                    <td>{l.qtyReceived}</td>
                    <td>{l.qtyInvoiced}</td>
                    <td className={l.qtyPending > 0 ? "bad" : "ok"}>{l.qtyPending}</td>
                    <td>{money(l.priceUnit, order.currency ?? "EUR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {order.status === "INCIDENCIA" && (
          <p className="si-warn"><AlertTriangle /> Facturado por encima de lo recibido: revisar abonos o cantidades en Odoo.</p>
        )}
      </aside>
    </div>
  );
}
