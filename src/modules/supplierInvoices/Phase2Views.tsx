// Fase 2 · Bandeja documental y Pedidos sin facturar — sub-vistas de Facturas de proveedor.
// Se integra en SupplierInvoicesView mediante tabs. UI con feedback de carga en cada acción.

import { useEffect, useMemo, useState } from "react";
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
          base={base}
        />
      )}
    </section>
  );
}

type ProductLineEdit = {
  description: string;
  reference: string | null;
  quantity: number | null;
  priceUnit: number | null;
  discount: number | null;
  taxNames: string[];
  total: number | null;
};

function DocDetail({ doc, close, acting, extracting, onStatus, onAiExtract, base }: { doc: Doc; close: () => void; acting: string | null; extracting: string | null; onStatus: (id: string, s: string) => void; onAiExtract: (id: string) => void; base?: string }) {
  const ex = doc.extracted;
  const api = (s: string) => (base ?? "") + s;
  const [lines, setLines] = useState<ProductLineEdit[]>(() => (doc.extracted?.lines ?? []).map((l) => ({ ...l })));
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");

  const apiPath = api("/api/odoo/supplier-invoices/inbox");
  const previewUrl = `${apiPath}/preview?id=${encodeURIComponent(doc.driveFileId)}`;

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
      total: null,
    }]);
    setPickerOpen(false);
    setTerm("");
  };

  const updateLine = (i: number, patch: Partial<ProductLineEdit>) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
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
        body: JSON.stringify({ id: doc.driveFileId, lines }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "No se pudo guardar");
      setSaveMsg("Líneas guardadas en el registro local del LAB.");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Error guardando líneas");
    } finally {
      setSaving(false);
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

        <div className="si-drawer-split">
          <div className="si-pdf-pane">
            <h3><FileText size={14} /> PDF · streaming directo desde Drive</h3>
            <iframe className="si-pdf-frame" src={previewUrl} title={`Visor PDF: ${doc.name}`} />
          </div>

          <div className="si-form-pane">
            {isExcluded && (
              <p className="si-warn"><AlertTriangle /> No es una factura ({DOC_TYPE_ES[ex?.docType ?? ""] ?? ex?.docType ?? "documento"}): excluido del cotejo con Odoo. Rafa lo sacará de la carpeta SIN REVISAR.</p>
            )}

            <section>
              <h3>Datos extraídos</h3>
              <dl>
                <div><dt>Proveedor</dt><dd>{ex?.supplier || "—"}</dd></div>
                <div><dt>NIF/VAT</dt><dd>{ex?.supplierVat || "—"}</dd></div>
                <div><dt>Nº factura</dt><dd>{ex?.invoiceNumber || "—"}</dd></div>
                <div><dt>Fecha</dt><dd>{dt(ex?.invoiceDate ?? null)}</dd></div>
                <div><dt>Dirección facturación</dt><dd>{ex?.billingAddress || "—"}</dd></div>
                <div><dt>Base</dt><dd>{ex?.base != null ? money(ex.base, ex?.currency ?? "EUR") : "—"}</dd></div>
                <div><dt>Impuestos</dt><dd>{ex?.taxes != null ? money(ex.taxes, ex?.currency ?? "EUR") : "—"}</dd></div>
                <div><dt>Total</dt><dd><b>{ex?.total != null ? money(ex.total, ex?.currency ?? "EUR") : "—"}</b></dd></div>
                <div><dt>Confianza</dt><dd>{doc.confidence != null ? `${doc.confidence}%` : "—"}</dd></div>
              </dl>
              {ex?.warnings?.length ? <p className="si-warn"><AlertTriangle /> {ex.warnings.join(" · ")}</p> : null}
            </section>

            {doc.match && !isExcluded && (
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

            <section>
              <h3>Líneas del documento {lines.length ? `(${lines.length})` : ""}</h3>
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
                <button className="si-editor-add" onClick={() => { setPickerOpen((v) => !v); if (!catalog.length) void loadCatalog(); }} type="button">
                  {catalogLoading ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />} Editar productos
                </button>
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
                    {lines.map((l, i) => (
                      <div className="si-editor-line" key={i}>
                        <input aria-label="Descripción" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
                        <input aria-label="Cantidad" type="number" min="0" step="any" placeholder="Cant." value={l.quantity ?? ""} onChange={(e) => updateLine(i, { quantity: e.target.value === "" ? null : Number(e.target.value) })} />
                        <input aria-label="Precio unitario" type="number" min="0" step="0.01" placeholder="Precio" value={l.priceUnit ?? ""} onChange={(e) => updateLine(i, { priceUnit: e.target.value === "" ? null : Number(e.target.value) })} />
                        <input aria-label="Total" type="number" min="0" step="0.01" placeholder="Total" value={l.total ?? ""} onChange={(e) => updateLine(i, { total: e.target.value === "" ? null : Number(e.target.value) })} />
                        <button className="si-remove-line" aria-label="Quitar línea" onClick={() => removeLine(i)} type="button"><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
                {lines.length > 0 && (
                  <button className="si-editor-add" disabled={saving} onClick={() => void saveLinesLocal()} type="button">
                    {saving ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />} Guardar líneas
                  </button>
                )}
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
                <button disabled={acting !== null || doc.status === "PENDIENTE_COTEJO" || isExcluded} onClick={() => onStatus(doc.driveFileId, "PENDIENTE_COTEJO")}>
                  {acting === doc.driveFileId + "PENDIENTE_COTEJO" ? <RefreshCw className="spin" /> : <Clock />} Marcar en cotejo
                </button>
                <button disabled={acting !== null || doc.status === "VALIDADA" || isExcluded} onClick={() => onStatus(doc.driveFileId, "VALIDADA")}>
                  {acting === doc.driveFileId + "VALIDADA" ? <RefreshCw className="spin" /> : <CheckCircle2 />} Validar
                </button>
                <button disabled={acting !== null || doc.status === "INCIDENCIA" || isExcluded} onClick={() => onStatus(doc.driveFileId, "INCIDENCIA")}>
                  {acting === doc.driveFileId + "INCIDENCIA" ? <RefreshCw className="spin" /> : <AlertTriangle />} Incidencia
                </button>
              </div>
              <p className="si-note">Solo lectura: validar aquí no crea la factura en Odoo; eso llegará en la Fase 3 con tu aprobación.</p>
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
