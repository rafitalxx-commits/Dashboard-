// Fase 2 · Bandeja documental y Pedidos sin facturar — sub-vistas de Facturas de proveedor.
// Se integra en SupplierInvoicesView mediante tabs. UI con feedback de carga en cada acción.

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
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

type F = Record<string, string>;

type DocLine = {
  description: string;
  reference: string | null;
  quantity: number | null;
  priceUnit: number | null;
  discount: number | null;
  taxNames: string[];
  taxId?: number | null;
  taxAmount?: number | null;
  accountId?: number | null;
  accountName?: string | null;
  total: number | null;
  sourcePurchaseOrder?: string | null;
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
  odooDraftMoveId: number | null;
  odooDraftName: string | null;
  odooDraftState: string | null;
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
};

type PoLine = {
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
};

const money = (v: number, c = "EUR") =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: c || "EUR" }).format(v || 0);
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
      setMsg(`Escaneo terminado: ${x.added} nuevos, ${x.skippedKnown} ya conocidos${x.errors?.length ? `, ${x.errors.length} errores` : ""}`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error escaneando Drive");
    } finally {
      setScanning(false);
    }
  };

  const extract = async (ids?: string[]) => {
    setExtracting(ids?.length ? ids[0] : "batch");
    setMsg("");
    try {
      const r = await fetch(api("/api/odoo/supplier-invoices/inbox/extract"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids?.length ? { ids } : {}),
      });
      const x = await r.json();
      if (!r.ok) throw Error(x.message);
      const ok = x.results?.filter((z: { ok: boolean }) => z.ok).length ?? 0;
      const bad = (x.results?.length ?? 0) - ok;
      setMsg(`Extracción IA: ${ok} documentos OK${bad ? `, ${bad} con error` : ""}. Cotejo actualizado.`);
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
        body: JSON.stringify({ driveFileId, status }),
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
    { label: "Pedidos sin facturar", value: k?.pedidosSinFacturar ?? 0, detail: money(k?.importePedidosSinFacturar ?? 0), tone: "warn" },
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
          <p>Fase 2 · Bandeja documental · Drive + extracción + cotejo con Odoo (solo lectura)</p>
        </div>
        <div className="si-actions">
          <small>Último escaneo: {dt(data?.lastScanAt?.slice(0, 10) ?? null)}</small>
          <button className="si-primary" disabled={scanning} onClick={() => void scan()}>
            {scanning ? <RefreshCw className="spin" /> : <Inbox />}
            {scanning ? "Escaneando…" : "Escanear Drive"}
          </button>
          <button className="si-primary" disabled={extracting !== null || scanning} onClick={() => void extract()}>
            {extracting === "batch" ? <RefreshCw className="spin" /> : <Sparkles />}
            {extracting === "batch" ? "Extrayendo…" : "Extraer con IA"}
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
              <tr><td colSpan={9}>No hay documentos. Pulsa «Escanear Drive» para traer los PDFs de SIN REVISAR.</td></tr>
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
                      <span className={`si-match si-match-${doc.match.band}`}>{doc.match.score}% · {BAND_ES[doc.match.band]}</span>
                    ) : doc.extracted?.needsOcr ? (
                      <span className="si-match si-match-sin">OCR pendiente</span>
                    ) : "—"}
                  </td>
                  <td><span className={`si-badge doc-${doc.status}`}>{STATUS_ES[doc.status] ?? doc.status}</span></td>
                  <td className="si-actions-cell">
                    {doc.webViewLink && <a href={doc.webViewLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Ver PDF en Drive"><ExternalLink size={15} /></a>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <DocDetail
          doc={selected}
          close={() => setSelected(null)}
          acting={acting}
          extracting={extracting}
          onStatus={setStatus}
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
  dateOrder: string | null;
  amountTotal: number;
  currency: string | null;
  state: string;
  billedAmount: number;
  billedPct: number;
  pendingAmount: number;
  allReceived: boolean;
  lastReceptionAt: string | null;
  lines: { productId: number | null; productName: string | null; qtyOrdered: number; qtyReceived: number; qtyInvoiced: number; qtyPending: number; priceUnit: number; subtotal: number; discount: number }[];
};

type ProductLineEdit = {
  description: string;
  reference: string | null;
  quantity: number | null;
  priceUnit: number | null;
  discount: number | null;
  taxNames: string[];
  taxId?: number | null;
  taxAmount?: number | null;
  accountId?: number | null;
  accountName?: string | null;
  total: number | null;
  sourcePurchaseOrder?: string | null;
  sourceQtyOrdered?: number | null;
  sourceQtyReceived?: number | null;
  sourceQtyInvoiced?: number | null;
  sourceReceptionStatus?: "sin_recepcion" | "parcial" | "completa" | null;
};

function DocDetail({ doc, close, acting, extracting, onStatus, onAiExtract, onDocUpdated, base }: { doc: Doc; close: () => void; acting: string | null; extracting: string | null; onStatus: (id: string, s: string) => void; onAiExtract: (id: string) => void; onDocUpdated: (doc: Doc) => void; base?: string }) {
  const ex = doc.extracted;
  const api = (s: string) => (base ?? "") + s;
  const [lines, setLines] = useState<ProductLineEdit[]>(() => (doc.extracted?.lines ?? []).map((l) => ({ ...l })));
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [linesDirty, setLinesDirty] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [rematchMsg, setRematchMsg] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
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
  // Multi-pedido
  const [poOpen, setPoOpen] = useState(false);
  const [poCandidates, setPoCandidates] = useState<PoCandidate[]>([]);
  const [poLoading, setPoLoading] = useState(false);
  const [selectedPoIds, setSelectedPoIds] = useState<number[]>(doc.assignedPurchaseOrderIds ?? []);
  const [poSaving, setPoSaving] = useState(false);
  const [poMsg, setPoMsg] = useState("");
  const [receiptRefreshing, setReceiptRefreshing] = useState(false);
  const [receiptMsg, setReceiptMsg] = useState("");
  // Mini navegador de Drive (Fase 2.4): alojar el PDF validado en su carpeta definitiva
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveMsg, setDriveMsg] = useState("");
  const [driveRootId, setDriveRootId] = useState("");
  const [driveFolders, setDriveFolders] = useState<{ id: string; name: string }[]>([]);
  const [drivePath, setDrivePath] = useState<{ id: string; name: string }[]>([]);
  const [driveSuggest, setDriveSuggest] = useState<string[]>([]);
  const [driveTarget, setDriveTarget] = useState<{ id: string; path: string } | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [moving, setMoving] = useState(false);
  // Fase 3: puente con Odoo (borrador + contabilizar)
  const [odooBusy, setOdooBusy] = useState(false);
  const [odooMsg, setOdooMsg] = useState("");
  const [fiscalLoading, setFiscalLoading] = useState(false);
  const [fiscalMsg, setFiscalMsg] = useState("");
  const [taxOptions, setTaxOptions] = useState<{ id: number; name: string; rate: number }[]>([]);
  const [accountOptions, setAccountOptions] = useState<{ id: number; name: string }[]>([]);
  const [bulkTaxId, setBulkTaxId] = useState("");
  const [bulkAccountId, setBulkAccountId] = useState("");
  const [pdfWidth, setPdfWidth] = useState(() => {
    const stored = Number(localStorage.getItem("supplier-invoice-pdf-width"));
    return Number.isFinite(stored) && stored >= 25 && stored <= 55 ? stored : 42;
  });

  const apiPath = api("/api/odoo/supplier-invoices/inbox");
  const previewUrl = `${apiPath}/preview?id=${encodeURIComponent(doc.driveFileId)}`;
  const canSaveToDrive = doc.status === "VALIDADA" && Boolean(doc.odooDraftMoveId);

  useEffect(() => {
    setLines((doc.extracted?.lines ?? []).map((line) => ({ ...line })));
    setSelectedPoIds(doc.assignedPurchaseOrderIds ?? []);
    setLinesDirty(false);
  }, [doc.driveFileId, doc.extracted?.lines, doc.assignedPurchaseOrderIds]);

  useEffect(() => { localStorage.setItem("supplier-invoice-pdf-width", String(pdfWidth)); }, [pdfWidth]);

  const loadFiscalOptions = async () => {
    if (taxOptions.length || fiscalLoading) return;
    setFiscalLoading(true); setFiscalMsg("");
    try {
      const r = await fetch(`${apiPath}/fiscal-options`);
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudieron leer impuestos y cuentas");
      setTaxOptions(Array.isArray(x.taxes) ? x.taxes : []);
      setAccountOptions(Array.isArray(x.accounts) ? x.accounts : []);
    } catch (e) { setFiscalMsg(e instanceof Error ? e.message : "No se pudieron leer impuestos y cuentas"); }
    finally { setFiscalLoading(false); }
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
  const results = catalog
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

  const addProduct = (product: CatalogProduct) => {
    setLines((prev) => [...prev, {
      description: product.name,
      reference: product.reference || null,
      quantity: null,
      priceUnit: null,
      discount: null,
      taxNames: product.type === "service" ? [] : ["21%"],
      taxId: null, taxAmount: null, accountId: null, accountName: null,
      total: null,
    }]);
    setLinesDirty(true);
    setPickerOpen(false);
    setTerm("");
  };

  const updateLine = (i: number, patch: Partial<ProductLineEdit>) => {
    setLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l;
      const next = { ...l, ...patch };
      // Cantidad, precio y descuento son las fuentes del cálculo. El total
      // sigue siendo editable: si el operario modifica sólo el total, es una
      // corrección deliberada y no se sobrescribe.
      if (patch.quantity !== undefined || patch.priceUnit !== undefined || patch.discount !== undefined) {
        const quantity = next.quantity ?? 0;
        const priceUnit = next.priceUnit ?? 0;
        const discount = next.discount ?? 0;
        const base = quantity * priceUnit * (1 - discount / 100);
        // `total` sigue siendo la base neta: así el contrato existente del
        // borrador Odoo (líneas = base) no cambia. El total con IVA se deriva
        // visualmente de base + cuota.
        next.total = Math.round(base * 100) / 100;
      }
      return next;
    }));
    setLinesDirty(true);
  };

  const applyTaxToAllLines = () => {
    const taxId = bulkTaxId ? Number(bulkTaxId) : null;
    const tax = taxOptions.find((item) => item.id === taxId);
    setLines((prev) => prev.map((line) => ({ ...line, taxId, taxNames: tax ? [tax.name] : [] })));
    setLinesDirty(true);
  };

  const applyAccountToAllLines = () => {
    const accountId = bulkAccountId ? Number(bulkAccountId) : null;
    const account = accountOptions.find((item) => item.id === accountId);
    setLines((prev) => prev.map((line) => ({ ...line, accountId, accountName: account?.name ?? null })));
    setLinesDirty(true);
  };

  const removeLine = (i: number) => {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
    setLinesDirty(true);
  };

  const saveLinesLocal = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const r = await fetch(`${apiPath}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.driveFileId, lines, base: fields.base, taxes: fields.taxes }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo guardar");
      if (x.lines) setLines(x.lines);
      if (x.document) onDocUpdated(x.document);
      setLinesDirty(false);
      setSaveMsg("Líneas guardadas en el registro local del LAB.");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Error guardando líneas");
    } finally {
      setSaving(false);
    }
  };

  const rematch = async () => {
    setRematching(true);
    setRematchMsg("");
    try {
      const r = await fetch(`${apiPath}/rematch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.driveFileId }) });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo recalcular el cotejo");
      if (x.document) onDocUpdated(x.document);
      const match = x.match;
      setRematchMsg(match ? `Cotejo actualizado: ${match.score}% · ${BAND_ES[match.band] ?? match.band}.` : "Cotejo actualizado; no hay candidato automático.");
    } catch (e) {
      setRematchMsg(e instanceof Error ? e.message : "Error recalculando el cotejo");
    } finally {
      setRematching(false);
    }
  };

  const saveFields = async () => {
    setSavingFields(true);
    setFieldsMsg("");
    try {
      const r = await fetch(`${apiPath}/fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.driveFileId, fields }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo guardar");
      if (x.document) onDocUpdated(x.document);
      setFieldsMsg(x.mapping?.learned
        ? `Datos guardados. Mapeo aprendido de «${x.mapping.supplierName}»: sus próximas facturas se rellenarán solas.`
        : "Datos guardados.");
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
      const r = await fetch(`${apiPath}/po-filter?id=${encodeURIComponent(doc.driveFileId)}`);
      const x = await r.json();
      if (!r.ok) throw new Error(x.message);
      setPoCandidates(x.orders ?? []);
      if (!x.orders?.length) setPoMsg("No hay pedidos sin factura para este proveedor.");
    } catch (e) {
      setPoMsg(e instanceof Error ? e.message : "Error cargando pedidos");
    } finally {
      setPoLoading(false);
    }
  };

  const togglePo = (poId: number) => {
    const next = selectedPoIds.includes(poId)
      ? selectedPoIds.filter((n) => n !== poId)
      : [...selectedPoIds, poId];
    setSelectedPoIds(next);
    // La confirmación de la casilla es la decisión humana: persiste la
    // asociación local e importa al instante los datos reales de Odoo.
    void savePoLink(next);
  };

  const savePoLink = async (ids = selectedPoIds) => {
    setPoSaving(true);
    setPoMsg("");
    try {
      const r = await fetch(`${apiPath}/polink`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.driveFileId, purchaseOrderIds: ids }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo guardar");
      if (x.document) {
        onDocUpdated(x.document);
        setLines((x.document.extracted?.lines ?? []).map((line: ProductLineEdit) => ({ ...line })));
      }
      const warning = x.missingPriceLines ? ` Aviso: ${x.missingPriceLines} línea(s) sin precio se han añadido igualmente.` : "";
      setPoMsg(`Pedidos guardados e importados desde Odoo: ${x.addedLines ?? 0} línea(s).${warning}`);
    } catch (e) {
      setPoMsg(e instanceof Error ? e.message : "Error guardando asociación");
    } finally {
      setPoSaving(false);
    }
  };

  const refreshReceipts = async () => {
    setReceiptRefreshing(true);
    setReceiptMsg("");
    try {
      const r = await fetch(`${apiPath}/receipt-refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.driveFileId }) });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudieron actualizar las recepciones");
      if (x.document) {
        onDocUpdated(x.document);
        setLines((x.document.extracted?.lines ?? []).map((line: ProductLineEdit) => ({ ...line })));
      }
      setReceiptMsg(`Recepciones actualizadas desde Odoo: ${x.updatedLines ?? 0} línea(s).`);
    } catch (e) {
      setReceiptMsg(e instanceof Error ? e.message : "Error actualizando recepciones");
    } finally { setReceiptRefreshing(false); }
  };

  const receptionSummary = lines.filter((l) => l.sourcePurchaseOrder).reduce((acc, l) => {
    if (l.sourceReceptionStatus === "sin_recepcion") acc.none++;
    else if (l.sourceReceptionStatus === "parcial") acc.partial++;
    else if (l.sourceReceptionStatus === "completa") acc.complete++;
    return acc;
  }, { none: 0, partial: 0, complete: 0 });
  const receiptPending = receptionSummary.none > 0 || receptionSummary.partial > 0;

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
      try {
        const r = await fetch(`${apiPath}/drive/suggest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.driveFileId }) });
        const x = await r.json();
        if (r.ok) setDriveSuggest(x.path ?? []);
      } catch { /* sugerencia opcional */ }
    }
  };

  const enterFolder = async (folder: { id: string; name: string }) => {
    const ok = await loadFolders(folder.id);
    if (ok) setDrivePath((p) => [...p, folder]);
  };

  const goUp = async () => {
    const parent = drivePath.length > 1 ? drivePath[drivePath.length - 2].id : null;
    setDrivePath((p) => p.slice(0, -1));
    await loadFolders(parent);
  };

  const useSuggested = async () => {
    if (!driveSuggest.length || !driveRootId) return;
    setDriveLoading(true);
    setDriveMsg("");
    try {
      let parentId = driveRootId;
      const crumbs: { id: string; name: string }[] = [];
      for (const name of driveSuggest) {
        const r = await fetch(`${apiPath}/drive/create-folder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId, name }),
        });
        const x = await r.json();
        if (!r.ok) throw new Error(x.message || `No se pudo asegurar la carpeta ${name}`);
        parentId = x.folder.id;
        crumbs.push({ id: x.folder.id, name: x.folder.name ?? name });
      }
      setDrivePath(crumbs);
      setDriveTarget({ id: parentId, path: `/${driveSuggest.join("/")}` });
      setDriveMsg(`Carpeta lista: /${driveSuggest.join("/")} — pulsa «Mover PDF aquí».`);
    } catch (e) {
      setDriveMsg(e instanceof Error ? e.message : "Error preparando la ruta");
    } finally {
      setDriveLoading(false);
    }
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
        body: JSON.stringify({ parentId, name }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo crear la carpeta");
      setNewFolderName("");
      setDriveMsg(`Carpeta «${x.folder?.name ?? name}» lista.`);
      await loadFolders(parentId);
    } catch (e) {
      setDriveMsg(e instanceof Error ? e.message : "Error creando carpeta");
    } finally {
      setCreatingFolder(false);
    }
  };

  const selectCurrentFolder = () => {
    if (!drivePath.length) { setDriveMsg("Navega hasta una subcarpeta o usa la ruta sugerida."); return; }
    const path = "/" + drivePath.map((c) => c.name).join("/");
    setDriveTarget({ id: drivePath[drivePath.length - 1].id, path });
  };

  const movePdf = async () => {
    if (!driveTarget) return;
    setMoving(true);
    setDriveMsg("");
    try {
      const r = await fetch(`${apiPath}/drive/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.driveFileId, targetFolderId: driveTarget.id, targetFolderPath: driveTarget.path }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo mover el PDF");
      if (x.document) onDocUpdated(x.document);
      setDriveMsg(`PDF movido a ${driveTarget.path}.`);
    } catch (e) {
      setDriveMsg(e instanceof Error ? e.message : "Error moviendo el PDF");
    } finally {
      setMoving(false);
    }
  };

  // ===== Fase 3: Odoo (borrador + contabilizar) =====

  const createOdooDraft = async () => {
    setOdooBusy(true);
    setOdooMsg("");
    try {
      const r = await fetch(`${apiPath}/odoo-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.driveFileId }) });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo crear el borrador");
      if (x.document) onDocUpdated(x.document);
      const res = x.result ?? {};
      setOdooMsg(`Borrador ${res.name ?? ""} creado en Odoo.` + (res.warnings?.length ? ` Avisos: ${res.warnings.join(" · ")}` : ""));
    } catch (e) {
      setOdooMsg(e instanceof Error ? e.message : "Error creando borrador");
    } finally {
      setOdooBusy(false);
    }
  };

  const postOdooDraft = async () => {
    setOdooBusy(true);
    setOdooMsg("");
    try {
      const r = await fetch(`${apiPath}/odoo-post`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.driveFileId }) });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo contabilizar");
      if (x.document) onDocUpdated(x.document);
      const res = x.result ?? {};
      setOdooMsg(`Factura ${res.name ?? ""} contabilizada en Odoo.`);
    } catch (e) {
      setOdooMsg(e instanceof Error ? e.message : "Error contabilizando");
    } finally {
      setOdooBusy(false);
    }
  };

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

        <div className="si-drawer-split" style={{ "--si-pdf-width": `${pdfWidth}%` } as CSSProperties}>
          <div className="si-pdf-pane">
            <h3><FileText size={14} /> PDF · streaming directo desde Drive</h3>
            <iframe className="si-pdf-frame" src={previewUrl} title={`Visor PDF: ${doc.name}`} />
            <a className="si-primary si-pdf-open" href={previewUrl} target="_blank" rel="noopener noreferrer">
              <FileText size={14} /> Abrir PDF
            </a>
          </div>

          <div className="si-split-control" aria-label="Ancho del PDF y edición">
            <label htmlFor="si-pdf-width">PDF {pdfWidth}% · Edición {100 - pdfWidth}%</label>
            <input id="si-pdf-width" type="range" min="25" max="55" value={pdfWidth} onChange={(e) => setPdfWidth(Number(e.target.value))} />
          </div>

          <div className="si-form-pane">
            {isExcluded && (
              <p className="si-warn"><AlertTriangle /> No es una factura ({DOC_TYPE_ES[ex?.docType ?? ""] ?? ex?.docType ?? "documento"}): excluido del cotejo con Odoo. Rafa lo sacará de la carpeta SIN REVISAR.</p>
            )}

            <section>
              <h3>Datos extraídos</h3>
              <div className="si-edit-fields">
                <label>Proveedor
                  <input value={fields.supplier} onChange={(e) => setFields({ ...fields, supplier: e.target.value })} placeholder="Razón social" />
                </label>
                <label>NIF/VAT
                  <input value={fields.supplierVat} onChange={(e) => setFields({ ...fields, supplierVat: e.target.value })} placeholder="ESB12345674" />
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
              <button className="si-editor-add" disabled={savingFields} onClick={() => void saveFields()} type="button">
                {savingFields ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />} Guardar datos (y aprender proveedor)
              </button>
              {fieldsMsg && <p className={fieldsMsg.startsWith("Datos guardados") ? "si-msg" : "error"} role="status">{fieldsMsg}</p>}
              <p className="si-note">Todos los campos son editables. Al guardar se recuerda el proveedor corregido: sus próximas facturas se auto-rellenarán con lo aprendido.</p>
              {ex?.warnings?.length ? <p className="si-warn"><AlertTriangle /> {ex.warnings.join(" · ")}</p> : null}
            </section>

            {doc.match && !isExcluded && (
              <section>
                <h3>Cotejo con Odoo</h3>
                <p className="si-match-line">
                  <b>{doc.match.purchaseOrderName || "Sin candidato"}</b>
                  <span className={`si-match si-match-${doc.status === "VALIDADA" ? "alta" : doc.match.band}`}>{doc.status === "VALIDADA" ? "Cotejo confirmado" : `${doc.match.score}% · ${BAND_ES[doc.match.band]}`}</span>
                  {doc.match.totalDiff != null && <small>Diferencia total: {doc.match.totalDiff >= 0 ? "+" : ""}{money(doc.match.totalDiff)}</small>}
                </p>
                <ul className="si-criteria">
                  {doc.match.criteria.map((c) => {
                    const confirmed = doc.status === "VALIDADA";
                    const ok = confirmed || c.ok;
                    return <li key={c.key} className={ok ? "ok" : "bad"}>
                      {ok ? <CheckCircle2 size={14} /> : <X size={14} />} {c.label} — {confirmed ? "Confirmado manualmente" : c.detail}
                    </li>
                  })}
                </ul>
                {doc.match.invoiceNameOdoo && <p className="si-warn"><AlertTriangle /> Posible duplicado: ya existe {doc.match.invoiceNameOdoo} en Odoo.</p>}
              </section>
            )}

            {!isExcluded && (
              <section>
                <h3>¿Varios pedidos en una factura?</h3>
                <p className="si-note">Confirma aquí los pedidos de la factura. Al marcar o desmarcar uno se guarda la asociación local e importa de Odoo sus líneas pendientes, con origen, precio, descuento e impuestos pendientes de cotejo.</p>
                <button className="si-editor-add" disabled={poLoading} onClick={() => { if (!poOpen) void loadPoCandidates(); setPoOpen((v) => !v); }} type="button">
                  {poLoading ? <RefreshCw className="spin" size={14} /> : <ShoppingCart size={14} />} {poOpen ? "Ocultar pedidos" : "Asociar pedidos de compra"}
                </button>
                {poMsg && <p className={poMsg.startsWith("Pedidos guardados") ? "si-msg" : "error"} role="status">{poMsg}</p>}
                {poOpen && (
                  <div className="si-multipo">
                    {poCandidates.length === 0 ? (
                      <p className="si-note">No hay pedidos sin factura de este proveedor.</p>
                    ) : (
                      <>
                        <div className="si-pick si-pick-top">
                          <span>Seleccionados: <b>{selectedPoIds.length}</b> pedido(s)</span>
                          <button className="si-editor-add" disabled={poSaving} onClick={() => void savePoLink()} type="button">
                            {poSaving ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />} {poSaving ? "Importando desde Odoo…" : "Reimportar pedidos seleccionados"}
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
                                <td><b>{po.name}</b>{po.allReceived ? " · recibido" : " · parcial"}{po.origin ? <small> · ref. proveedor: {po.origin}</small> : null}</td>
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

            {!isExcluded && (
              <section className="si-drive-section">
                <h3>Guardar en Drive</h3>
                {doc.movedTo ? (
                  <p className="si-msg"><CheckCircle2 size={14} /> PDF ya archivado en {doc.targetFolderPath ?? doc.movedTo}.</p>
                ) : (
                  <>
                    <p className="si-note">Última acción: guarda el PDF en su carpeta definitiva (/AÑO/PROVEEDOR/TRIMESTRE) sólo después de validar la factura y crear su borrador en Odoo.</p>
                    <button className="si-editor-add" disabled={!canSaveToDrive || moving} onClick={() => void openDrive()} type="button">
                      <Folder size={14} /> {driveOpen ? "Ocultar Guardar en Drive" : "Guardar en Drive"}
                    </button>
                    {!canSaveToDrive && <p className="si-note">Disponible tras <b>Validar</b> y cuando exista el <b>borrador en Odoo</b>.</p>}
                    {driveMsg && <p className={driveMsg.startsWith("PDF movido") || driveMsg.startsWith("Carpeta") ? "si-msg" : "error"} role="status">{driveMsg}</p>}
                    {driveOpen && (
                      <div className="si-drive-nav">
                        <div className="si-drive-crumb">
                          <button type="button" onClick={() => void goUp()} disabled={!drivePath.length || driveLoading} title="Subir un nivel"><ChevronLeft size={14} /></button>
                          <span>Bandeja{drivePath.map((c) => ` / ${c.name}`).join("")}</span>
                        </div>
                        {driveSuggest.length > 0 && (
                          <button className="si-drive-suggest" disabled={driveLoading || moving} onClick={() => void useSuggested()} type="button">
                            <Sparkles size={14} /> Usar sugerencia: /{driveSuggest.join("/")}
                          </button>
                        )}
                        <ul className="si-drive-folders">
                          {driveLoading && <li className="si-note">Cargando…</li>}
                          {!driveLoading && driveFolders.length === 0 && <li className="si-note">Sin subcarpetas aquí.</li>}
                          {driveFolders.map((f) => (
                            <li key={f.id}>
                              <button type="button" onClick={() => void enterFolder(f)}>
                                <Folder size={14} /> {f.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                        <div className="si-drive-newfolder">
                          <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Nueva carpeta aquí…" aria-label="Nombre de nueva carpeta" />
                          <button type="button" disabled={creatingFolder || !newFolderName.trim()} onClick={() => void createFolderHere()}>
                            {creatingFolder ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />} Crear
                          </button>
                        </div>
                        <div className="si-pick">
                          <button className="si-editor-add" type="button" disabled={driveLoading || !drivePath.length} onClick={selectCurrentFolder}>Usar carpeta actual</button>
                          <button className="si-editor-add" type="button" disabled={!driveTarget || moving} onClick={() => void movePdf()}>
                            {moving ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />} Mover PDF aquí
                          </button>
                        </div>
                        {driveTarget && <p className="si-note">Destino seleccionado: <b>{driveTarget.path}</b></p>}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {!isExcluded && (
              <section className="si-odoo-section">
                <h3>Factura en Odoo</h3>
                {doc.odooDraftMoveId ? (
                  <div className="si-odoo-state">
                    <p className="si-msg"><CheckCircle2 size={14} /> Borrador <b>{doc.odooDraftName ?? doc.odooDraftMoveId}</b> creado en Odoo · estado: {doc.odooDraftState ?? "draft"}</p>
                    {doc.odooDraftState === "posted" ? (
                      <p className="si-msg"><CheckCircle2 size={14} /> Factura contabilizada en Odoo.</p>
                    ) : (
                      <button className="si-editor-add" disabled={odooBusy} onClick={() => void postOdooDraft()} type="button">
                        {odooBusy ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />} Contabilizar en Odoo
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="si-note">El borrador se crea únicamente con este botón final, después de validar el cotejo.</p>
                    <button className="si-editor-add" disabled={odooBusy || doc.status !== "VALIDADA"} onClick={() => void createOdooDraft()} type="button">
                      {odooBusy ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />} Crear borrador en Odoo
                    </button>
                    {doc.status !== "VALIDADA" && <p className="si-note">Primero valida la factura para poder crear el borrador.</p>}
                  </>
                )}
                {odooMsg && <p className={odooMsg.startsWith("Borrador") || odooMsg.startsWith("Factura") ? "si-msg" : "error"} role="status">{odooMsg}</p>}
              </section>
            )}

            <section>
              <h3>Líneas del documento {lines.length ? `(${lines.length})` : ""}</h3>
              {selectedPoIds.length > 0 && (
                <div className={receiptPending ? "si-reception-state pending" : "si-reception-state complete"} role="status">
                  <span>{receiptPending ? "Pendiente de recepción en Odoo" : "Recepción completa en Odoo"}</span>
                  <small>{receptionSummary.complete} completa(s) · {receptionSummary.partial} parcial(es) · {receptionSummary.none} sin recepción</small>
                  <button type="button" className="si-editor-add" disabled={receiptRefreshing} onClick={() => void refreshReceipts()}>
                    {receiptRefreshing ? <RefreshCw className="spin" size={14} /> : <RefreshCw size={14} />} Actualizar recepción Odoo
                  </button>
                </div>
              )}
              {receiptMsg && <p className={receiptMsg.startsWith("Recepciones") ? "si-msg" : "error"} role="status">{receiptMsg}</p>}
              {lines.length ? (
                <ul className="si-doc-lines">
                  {lines.map((l, i) => (
                    <li key={i}>
                      <span>{l.description} {l.reference ? <small>· {l.reference}</small> : null}</span>
                      <small>{l.quantity ?? "—"} × {l.priceUnit != null ? money(l.priceUnit, ex?.currency ?? "EUR") : "—"} = {l.total != null ? money(l.total, ex?.currency ?? "EUR") : "—"}</small>
                    </li>
                  ))}
                </ul>
              ) : <p className="si-note">Sin líneas detectadas. Usa el editor para añadir productos (consumibles, servicios…).</p>}

              <div className="si-product-editor">
                <button className="si-editor-add" onClick={() => { setPickerOpen((v) => !v); if (!catalog.length) void loadCatalog(); void loadFiscalOptions(); }} type="button">
                  {catalogLoading ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />} Editar productos
                </button>
                {!pickerOpen && lines.length > 0 && <button className="si-editor-add" onClick={() => void loadFiscalOptions()} disabled={fiscalLoading} type="button">
                  {fiscalLoading ? <RefreshCw className="spin" size={14} /> : <RefreshCw size={14} />} Cargar impuestos y cuentas de Odoo
                </button>}
                {fiscalMsg && <p className="error" role="alert">{fiscalMsg}</p>}
                {pickerOpen && (
                  <div className="si-product-picker">
                    <label>Buscar en el catálogo de Odoo (no almacenables incluidos)
                      <input autoFocus aria-autocomplete="list" aria-controls="si-product-suggestions"
                        onChange={(e) => setTerm(e.target.value)}
                        onKeyDown={(event) => { if (event.key === "Enter" && results[0]) { event.preventDefault(); addProduct(results[0]); } }}
                        placeholder="Escribe nombre, referencia o EAN" value={term} />
                    </label>
                    {catalogLoading && <span role="status">Buscando productos…</span>}
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
                    <div className="si-bulk-fiscal" aria-label="Aplicar impuesto y cuenta a todas las líneas">
                      <label>Aplicar impuesto a todas
                        <select value={bulkTaxId} onFocus={() => void loadFiscalOptions()} onChange={(e) => setBulkTaxId(e.target.value)}>
                          <option value="">Seleccionar impuesto de compra</option>
                          {taxOptions.map((tax) => <option key={tax.id} value={tax.id}>{tax.name}</option>)}
                        </select>
                      </label>
                      <button type="button" onClick={applyTaxToAllLines} disabled={!bulkTaxId}>Aplicar impuesto</button>
                      <label>Aplicar cuenta a todas
                        <select value={bulkAccountId} onFocus={() => void loadFiscalOptions()} onChange={(e) => setBulkAccountId(e.target.value)}>
                          <option value="">Seleccionar cuenta</option>
                          {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                        </select>
                      </label>
                      <button type="button" onClick={applyAccountToAllLines} disabled={!bulkAccountId}>Aplicar cuenta</button>
                    </div>
                    {lines.map((l, i) => (
                      <div className="si-editor-line" key={`${l.sourcePurchaseOrder ?? "manual"}-${i}`}>
                        <input aria-label="Descripción" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
                        <span className="si-line-origin" title="Pedido de compra de origen">{l.sourcePurchaseOrder ?? "Manual"}</span>
                        {l.sourcePurchaseOrder && <small className={`si-reception-badge ${l.sourceReceptionStatus ?? "sin_recepcion"}`}> {l.sourceReceptionStatus === "completa" ? "Recibido" : l.sourceReceptionStatus === "parcial" ? `Parcial ${l.sourceQtyReceived ?? 0}/${l.sourceQtyOrdered ?? 0}` : "Sin recepción"}</small>}
                        <input aria-label="Cantidad" type="number" min="0" step="any" placeholder="Cant." value={l.quantity ?? ""} onChange={(e) => updateLine(i, { quantity: e.target.value === "" ? null : Number(e.target.value) })} />
                        <input aria-label="Precio unitario" type="number" min="0" step="0.01" placeholder="Precio" value={l.priceUnit ?? ""} onChange={(e) => updateLine(i, { priceUnit: e.target.value === "" ? null : Number(e.target.value) })} />
                        <input aria-label="Descuento" type="number" min="0" max="100" step="0.01" placeholder="Dto. %" value={l.discount ?? ""} onChange={(e) => updateLine(i, { discount: e.target.value === "" ? null : Number(e.target.value) })} />
                        <select aria-label="Impuesto Odoo" value={l.taxId ?? ""} onFocus={() => void loadFiscalOptions()} onChange={(e) => {
                          const taxId = e.target.value ? Number(e.target.value) : null;
                          const tax = taxOptions.find((item) => item.id === taxId);
                          updateLine(i, { taxId, taxNames: tax ? [tax.name] : [] });
                        }}>
                          <option value="">Impuesto</option>
                          {taxOptions.map((tax) => <option key={tax.id} value={tax.id}>{tax.name} ({tax.rate}%)</option>)}
                        </select>
                        <input aria-label="Cuota impuesto" type="number" min="0" step="0.01" placeholder="Cuota IVA" value={l.taxAmount ?? ""} onChange={(e) => updateLine(i, { taxAmount: e.target.value === "" ? null : Number(e.target.value) })} />
                        <select aria-label="Cuenta contable Odoo" value={l.accountId ?? ""} onFocus={() => void loadFiscalOptions()} onChange={(e) => {
                          const accountId = e.target.value ? Number(e.target.value) : null;
                          updateLine(i, { accountId, accountName: accountOptions.find((account) => account.id === accountId)?.name ?? null });
                        }}>
                          <option value="">Cuenta</option>
                          {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                        </select>
                        <input aria-label="Base neta" type="number" min="0" step="0.01" placeholder="Base" value={l.total ?? ""} onChange={(e) => updateLine(i, { total: e.target.value === "" ? null : Number(e.target.value) })} />
                        <output className="si-line-gross" aria-label="Total con IVA">{money((l.total ?? 0) + (l.taxAmount ?? 0), ex?.currency ?? "EUR")}</output>
                        <button className="si-remove-line" aria-label="Quitar línea" onClick={() => removeLine(i)} type="button"><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
                {lines.length > 0 && (
                  <div className="si-lines-totals">
                    {(() => {
                      const calculatedBase = lines.reduce((acc, l) => acc + (l.total ?? 0), 0);
                      const calculatedTax = lines.reduce((acc, l) => acc + (l.taxAmount ?? 0), 0);
                      const declaredBase = fields.base !== "" ? Number(fields.base) : calculatedBase;
                      const declaredTax = fields.taxes !== "" ? Number(fields.taxes) : calculatedTax;
                      const declared = fields.total !== "" ? Number(fields.total) : null;
                      return (
                        <div className="si-totals-grid">
                          <label>Base imponible total
                            <input aria-label="Base imponible total" type="number" min="0" step="0.01" value={fields.base} onChange={(e) => { setFields({ ...fields, base: e.target.value }); setLinesDirty(true); }} />
                          </label>
                          <label>Impuesto total
                            <input aria-label="Impuesto total" type="number" min="0" step="0.01" value={fields.taxes} onChange={(e) => { setFields({ ...fields, taxes: e.target.value }); setLinesDirty(true); }} />
                          </label>
                          <span>Total con IVA: <b>{money((Number.isFinite(declaredBase) ? declaredBase : 0) + (Number.isFinite(declaredTax) ? declaredTax : 0), ex?.currency ?? "EUR")}</b></span>
                          {declared != null && Math.abs(declared - ((Number.isFinite(declaredBase) ? declaredBase : 0) + (Number.isFinite(declaredTax) ? declaredTax : 0))) > 0.005 && <small>El total PDF declarado difiere: {money(declared, ex?.currency ?? "EUR")}</small>}
                        </div>
                      );
                    })()}
                  </div>
                )}
                {lines.length > 0 && (
                  <button className="si-editor-add" disabled={saving} onClick={() => void saveLinesLocal()} type="button">
                    {saving ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />} {saving ? "Guardando cambios…" : "Guardar cambios de productos"}
                  </button>
                )}
                {linesDirty && !saving && <p className="si-note" role="status">Cambios sin guardar en el registro local.</p>}
                {saveMsg && <p className={saveMsg.startsWith("Líneas") ? "si-msg" : "error"} role="status">{saveMsg}</p>}
                <p className="si-note">Solo se guarda en el registro local del LAB; nada se escribe en Odoo ni Drive.</p>
              </div>
            </section>

            <section>
              <h3>Acciones</h3>
              <div className="si-doc-actions">
                <button disabled={extracting !== null || isExcluded} onClick={() => onAiExtract(doc.driveFileId)} title="Extraer proveedor, nº factura, fechas e importes con IA">
                  {extracting === doc.driveFileId ? <RefreshCw className="spin" /> : <Sparkles />} Extraer con IA
                </button>
                <button disabled={rematching || isExcluded} onClick={() => void rematch()} title="Recalcula coincidencias y diferencias con los datos actuales">
                  {rematching ? <RefreshCw className="spin" /> : <RefreshCw />} {rematching ? "Recalculando cotejo…" : "Recalcular cotejo"}
                </button>
                <button disabled={acting !== null || doc.status === "VALIDADA" || isExcluded || receiptPending} onClick={() => onStatus(doc.driveFileId, "VALIDADA")} title={receiptPending ? "Actualiza y completa la recepción de Odoo antes de validar" : "Confirma que las correcciones manuales son correctas; no crea el borrador Odoo"}>
                  {acting === doc.driveFileId + "VALIDADA" ? <RefreshCw className="spin" /> : <CheckCircle2 />} Validar
                </button>
                <button disabled={acting !== null || doc.status === "INCIDENCIA" || isExcluded} onClick={() => onStatus(doc.driveFileId, "INCIDENCIA")}>
                  {acting === doc.driveFileId + "INCIDENCIA" ? <RefreshCw className="spin" /> : <AlertTriangle />} Incidencia
                </button>
              </div>
              {rematchMsg && <p className={rematchMsg.startsWith("Cotejo actualizado") ? "si-msg" : "error"} role="status">{rematchMsg}</p>}
              <p className="si-note">«Validar» confirma tu revisión manual y deja todos los criterios en verde; no crea un borrador. Cuando quieras, usa después «Crear borrador en Odoo».</p>
            </section>

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
          <small>Última sync: {dt(data?.lastPoSyncAt?.slice(0, 10) ?? null)}</small>
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
                  <td><b>{o.name}</b></td>
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
