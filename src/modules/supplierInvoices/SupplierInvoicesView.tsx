import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Filter,
  PieChart,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import "./supplierInvoices.css";
import { InboxView, UnbilledView } from "./Phase2Views";

type F = Record<string, string>;
type L = {
  productName: string | null;
  productRef: string | null;
  name: string;
  quantity: number;
  priceUnit: number;
  discount: number;
  taxNames: string[];
  subtotal: number;
  total: number;
  displayType: string;
};
type I = {
  id: number;
  name: string;
  ref: string | null;
  state: string;
  paymentState: string;
  invoiceDate: string | null;
  accountingDate: string | null;
  dueDate: string | null;
  currency: string | null;
  journal: string | null;
  partnerId: number;
  partnerName: string;
  partnerVat: string | null;
  partnerCountry: string | null;
  fiscalPosition: string | null;
  amountUntaxed: number;
  amountTax: number;
  amountTotal: number;
  amountResidual: number;
  amountPaid: number;
  invoiceOrigin: string | null;
  taxSummary: string[];
  linkedPurchaseOrderNames: string[];
  linkedPickingNames: string[];
  lines: L[];
  attachments: { name: string }[];
  hasPdf: boolean;
  lastSyncAt: string | null;
};
type P = {
  total: number;
  items: I[];
  kpis: any;
  charts: any;
  options: any;
  lastSyncAt: string | null;
  odooBaseUrl: string | null;
};
const base =
  import.meta.env.BASE_URL === "/"
    ? ""
    : import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (s: string) => base + s;
const money = (v: number, c = "EUR") =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: c || "EUR",
  }).format(v || 0);
const d = (v: string | null) =>
  v ? new Intl.DateTimeFormat("es-ES").format(new Date(v + "T12:00:00")) : "—";
const st = (v: string) =>
  ({ draft: "Borrador", posted: "Publicada", cancel: "Cancelada" })[v] ||
  v ||
  "—";
const pay = (v: string) =>
  ({
    paid: "Pagada",
    partial: "Parcial",
    not_paid: "Pendiente",
    in_payment: "En proceso",
  })[v] || "Pendiente";
const initial: F = {
  from: "",
  to: "",
  year: String(new Date().getFullYear()),
  month: "",
  partnerId: "",
  country: "",
  state: "",
  paymentState: "",
  product: "",
  purchaseOrder: "",
  currency: "",
  fiscalPosition: "",
  minAmount: "",
  maxAmount: "",
  text: "",
};

export function SupplierInvoicesView({
  analyticsOnly = false,
}: {
  analyticsOnly?: boolean;
}) {
  const [draft, setDraft] = useState<F>(initial),
    [filters, setFilters] = useState<F>(initial),
    [data, setData] = useState<P | null>(null),
    [page, setPage] = useState(0),
    [loading, setLoading] = useState(true),
    [syncing, setSyncing] = useState(false),
    [msg, setMsg] = useState(""),
    [selected, setSelected] = useState<I | null>(null),
    [sort, setSort] = useState("invoiceDate"),
    [dir, setDir] = useState("desc"),
    [tab, setTab] = useState<"hist" | "inbox" | "unbilled">(analyticsOnly ? "hist" : "inbox");
  const qs = useMemo(() => {
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
    q.set("page", String(page));
    q.set("pageSize", "25");
    q.set("sortKey", sort);
    q.set("sortDir", dir);
    return q.toString();
  }, [filters, page, sort, dir]);
  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(api(`/api/odoo/supplier-invoices?${qs}`));
      const x = await r.json();
      if (!r.ok) throw Error(x.message);
      setData(x);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error leyendo Odoo");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [qs]);
  const field = (k: string, v: string) => setDraft((x) => ({ ...x, [k]: v }));
  const apply = () => {
    setPage(0);
    setFilters(draft);
  };
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await fetch(api("/api/odoo/supplier-invoices/sync"), {
        method: "POST",
      });
      const x = await r.json();
      if (!r.ok) throw Error(x.message);
      setMsg(`Sincronizado desde Odoo · ${x.meta.totalInvoices} documentos`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo sincronizar");
    } finally {
      setSyncing(false);
    }
  };
  const exp = (fmt: string) => {
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
    q.set("format", fmt);
    window.open(api(`/api/odoo/supplier-invoices/export?${q}`), "_blank");
  };
  if (tab === "hist" && !data && loading)
    return (
      <section className="supplier-invoices si-loading">
        <RefreshCw className="spin" /> Cargando facturas de proveedor…
      </section>
    );
  const x =
    data ??
    ({
      total: 0,
      items: [],
      kpis: {},
      charts: {},
      options: {},
      lastSyncAt: null,
      odooBaseUrl: null,
    } as P);
  const o = x.options || {};
  return (
    <section className="supplier-invoices">
      {!analyticsOnly && (
        <nav className="si-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "hist"}
            className={tab === "hist" ? "active" : ""}
            onClick={() => setTab("hist")}
          >
            Histórico
          </button>
          <button
            role="tab"
            aria-selected={tab === "inbox"}
            className={tab === "inbox" ? "active" : ""}
            onClick={() => setTab("inbox")}
          >
            Bandeja documental
          </button>
          <button
            role="tab"
            aria-selected={tab === "unbilled"}
            className={tab === "unbilled" ? "active" : ""}
            onClick={() => setTab("unbilled")}
          >
            Pedidos sin facturar
          </button>
        </nav>
      )}
      {tab !== "hist" && !analyticsOnly ? (
        tab === "inbox" ? (
          <InboxView base={base} />
        ) : (
          <UnbilledView base={base} />
        )
      ) : (
      <>
      <header className="si-head">
        <div>
          <p className="eyebrow">Compras / Facturas de proveedor</p>
          <h2>
            {analyticsOnly ? "Analítica compras" : "Facturas de proveedor"}
          </h2>
          <p>Fase 1 · Histórico y analítica · datos sincronizados desde Odoo</p>
        </div>
        <div className="si-actions">
          <small>
            Fuente de verdad: Odoo · Última:{" "}
            {d(x.lastSyncAt?.slice(0, 10) || null)}
          </small>
          <button
            className="si-primary"
            disabled={syncing}
            onClick={() => void sync()}
          >
            {syncing ? <RefreshCw className="spin" /> : <RefreshCw />}
            {syncing ? "Sincronizando…" : "Sincronizar Odoo"}
          </button>
          <button onClick={() => exp("csv")}>
            <Download />
            CSV
          </button>
          <button onClick={() => exp("xlsx")}>
            <Download />
            XLSX
          </button>
          <button onClick={() => exp("pdf")}>
            <Download />
            PDF
          </button>
        </div>
      </header>
      {msg && (
        <p className="si-msg" role="status">
          {msg}
        </p>
      )}
      <Kpis k={x.kpis} />
      <section className="si-filters">
        <div className="si-filter-title">
          <Filter /> <b>Filtros</b>
          <small>Los KPIs y gráficos reaccionan a los filtros.</small>
        </div>
        <div className="si-filter-grid">
          <Input l="Desde">
            <input
              type="date"
              value={draft.from}
              onChange={(e) => field("from", e.target.value)}
            />
          </Input>
          <Input l="Hasta">
            <input
              type="date"
              value={draft.to}
              onChange={(e) => field("to", e.target.value)}
            />
          </Input>
          <Select
            l="Año"
            v={draft.year}
            set={(v) => field("year", v)}
            a={[
              String(new Date().getFullYear()),
              ...x.items.map((i) => i.invoiceDate?.slice(0, 4) || ""),
            ].filter(Boolean)}
          />
          <Select
            l="Mes"
            v={draft.month}
            set={(v) => field("month", v)}
            a={Array.from({ length: 12 }, (_, i) => String(i + 1))}
          />
          <Select
            l="Proveedor"
            v={draft.partnerId}
            set={(v) => field("partnerId", v)}
            a={(o.vendors || []).map((z: any) => String(z.id))}
            n={(o.vendors || []).map((z: any) => z.name)}
          />
          <Select
            l="País"
            v={draft.country}
            set={(v) => field("country", v)}
            a={o.countries || []}
          />
          <Select
            l="Estado factura"
            v={draft.state}
            set={(v) => field("state", v)}
            a={o.states || []}
            n={(o.states || []).map(st)}
          />
          <Select
            l="Estado pago"
            v={draft.paymentState}
            set={(v) => field("paymentState", v)}
            a={o.paymentStates || []}
            n={(o.paymentStates || []).map(pay)}
          />
          <Select
            l="Producto"
            v={draft.product}
            set={(v) => field("product", v)}
            a={o.products || []}
          />
          <Select
            l="Pedido compra"
            v={draft.purchaseOrder}
            set={(v) => field("purchaseOrder", v)}
            a={o.purchaseOrders || []}
          />
          <Select
            l="Moneda"
            v={draft.currency}
            set={(v) => field("currency", v)}
            a={o.currencies || []}
          />
          <Select
            l="Tipo / impuesto fiscal"
            v={draft.fiscalPosition}
            set={(v) => field("fiscalPosition", v)}
            a={o.fiscalPositions || []}
          />
          <Input l="Importe mínimo">
            <input
              type="number"
              value={draft.minAmount}
              onChange={(e) => field("minAmount", e.target.value)}
            />
          </Input>
          <Input l="Importe máximo">
            <input
              type="number"
              value={draft.maxAmount}
              onChange={(e) => field("maxAmount", e.target.value)}
            />
          </Input>
          <label className="si-search">
            <span>Buscar texto</span>
            <Search size={15} />
            <input
              value={draft.text}
              onChange={(e) => field("text", e.target.value)}
              placeholder="Factura, proveedor, producto, VAT, pedido…"
            />
          </label>
          <div className="si-filter-buttons">
            <button className="si-primary" onClick={apply}>
              <Filter />
              Aplicar
            </button>
            <button
              onClick={() => {
                setDraft(initial);
                setFilters(initial);
                setPage(0);
              }}
            >
              Limpiar
            </button>
          </div>
        </div>
      </section>
      <section className="si-charts">
        <Monthly rows={x.charts.monthly || []} />
        <Top rows={x.charts.topVendors || []} />
        <Payments rows={x.charts.payment} />
      </section>
      {!analyticsOnly && (
        <>
          <header className="si-table-head">
            <div>
              <h3>Histórico de facturas de proveedor</h3>
              <p>
                Mostrando{" "}
                {x.total
                  ? `${page * 25 + 1}–${Math.min((page + 1) * 25, x.total)}`
                  : "0"}{" "}
                de {x.total} facturas
              </p>
            </div>
          </header>
          <div className="si-table">
            <table>
              <thead>
                <tr>
                  {[
                    ["ref", "Factura proveedor"],
                    ["name", "Interno Odoo"],
                    ["partnerName", "Proveedor"],
                    ["invoiceDate", "Fecha factura"],
                    ["dueDate", "Vencimiento"],
                    ["state", "Estado"],
                    ["paymentState", "Pago"],
                    ["currency", "Moneda"],
                    ["amountUntaxed", "Base"],
                    ["amountTax", "Impuestos"],
                    ["amountTotal", "Total"],
                    ["amountResidual", "Pendiente"],
                    ["purchaseOrderNames", "Pedido compra"],
                    ["pdf", "PDF"],
                  ].map(([k, l]) => (
                    <th key={k}>
                      <button
                        onClick={() => {
                          if (k !== "pdf") {
                            setSort(k);
                            setDir(
                              k === sort && dir === "asc" ? "desc" : "asc",
                            );
                          }
                        }}
                      >
                        {l}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={14}>Actualizando resultados…</td>
                  </tr>
                ) : (
                  x.items.map((i) => (
                    <tr key={i.id} onClick={() => setSelected(i)}>
                      <td>{i.ref || "—"}</td>
                      <td>{i.name}</td>
                      <td>
                        <b>{i.partnerName}</b>
                        <small>{i.partnerVat || "—"}</small>
                      </td>
                      <td>{d(i.invoiceDate)}</td>
                      <td>{d(i.dueDate)}</td>
                      <td>
                        <Badge t="state" v={i.state} />
                      </td>
                      <td>
                        <Badge t="payment" v={i.paymentState} />
                      </td>
                      <td>{i.currency}</td>
                      <td>{money(i.amountUntaxed, i.currency || "EUR")}</td>
                      <td>{money(i.amountTax, i.currency || "EUR")}</td>
                      <td>
                        <b>{money(i.amountTotal, i.currency || "EUR")}</b>
                      </td>
                      <td className="si-due">
                        {money(i.amountResidual, i.currency || "EUR")}
                      </td>
                      <td>
                        {i.linkedPurchaseOrderNames.join(", ") || "—"}
                      </td>
                      <td>{i.hasPdf ? "Sí" : "No"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="si-mobile">
            {x.items.map((i) => (
              <button key={i.id} onClick={() => setSelected(i)}>
                <b>{i.partnerName}</b>
                <span>{i.ref || i.name}</span>
                <small>
                  {d(i.invoiceDate)} ·{" "}
                  {money(i.amountTotal, i.currency || "EUR")}
                </small>
                <Badge t="payment" v={i.paymentState} />
                <em>
                  Pendiente {money(i.amountResidual, i.currency || "EUR")}
                </em>
              </button>
            ))}
          </div>
          <nav className="si-pages">
            <button disabled={!page} onClick={() => setPage(page - 1)}>
              <ChevronLeft />
            </button>
            <span>
              Página {page + 1} de {Math.max(1, Math.ceil(x.total / 25))}
            </span>
            <button
              disabled={(page + 1) * 25 >= x.total}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight />
            </button>
          </nav>
        </>
      )}
      {selected && (
        <Detail
          i={selected}
          base={x.odooBaseUrl}
          close={() => setSelected(null)}
        />
      )}
      </>
      )}
    </section>
  );
}
function Input({ l, children }: { l: string; children: React.ReactNode }) {
  return (
    <label className="si-field">
      <span>{l}</span>
      {children}
    </label>
  );
}
function Select({
  l,
  v,
  set,
  a,
  n,
}: {
  l: string;
  v: string;
  set: (v: string) => void;
  a: string[];
  n?: string[];
}) {
  return (
    <Input l={l}>
      <select value={v} onChange={(e) => set(e.target.value)}>
        <option value="">Todos</option>
        {[...new Set(a)].map((z, i) => (
          <option key={z} value={z}>
            {n?.[i] || z}
          </option>
        ))}
      </select>
    </Input>
  );
}
function Badge({ t, v }: { t: string; v: string }) {
  return (
    <span className={`si-badge ${t}-${v}`}>
      {t === "state" ? st(v) : pay(v)}
    </span>
  );
}
function Kpis({ k }: { k: any }) {
  const a = [
    ["Facturado proveedores", money(k.periodTotal), "periodo filtrado"],
    ["Facturado año actual", money(k.yearTotal), "acumulado anual"],
    ["Nº facturas del mes", k.periodCount, "periodo filtrado"],
    ["Pendiente de pago", money(k.pendingTotal), "importe residual"],
    ["Pagado este mes", money(k.paidTotal), "importe aplicado"],
    ["Ticket medio", money(k.averageTicket), "por factura"],
    ["Proveedores activos", k.activeVendors, "con facturación"],
    [
      "Variación vs periodo anterior",
      k.variationPct == null
        ? "—"
        : `${k.variationPct >= 0 ? "+" : ""}${k.variationPct.toFixed(1)}%`,
      money(k.previousPeriodTotal),
    ],
  ];
  return (
    <section className="si-kpis">
      {a.map((r: any) => (
        <article key={r[0]}>
          <span>{r[0]}</span>
          <strong>{r[1]}</strong>
          <small>{r[2]}</small>
        </article>
      ))}
    </section>
  );
}
function Monthly({ rows }: { rows: any[] }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <article className="si-chart">
      <h3>
        <BarChart3 />
        Evolución mensual de compras
      </h3>
      <div className="si-bars">
        {rows.map((r) => (
          <div key={r.month}>
            <i style={{ height: `${Math.max(3, (r.total / max) * 100)}%` }} />
            <small>
              {new Intl.DateTimeFormat("es-ES", { month: "short" }).format(
                new Date(2026, r.month - 1, 1),
              )}
            </small>
          </div>
        ))}
      </div>
    </article>
  );
}
function Top({ rows }: { rows: any[] }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <article className="si-chart">
      <h3>
        <BarChart3 />
        Top proveedores por importe
      </h3>
      {rows.map((r) => (
        <div className="si-top" key={r.name}>
          <span>{r.name}</span>
          <i>
            <b style={{ width: `${(r.total / max) * 100}%` }} />
          </i>
          <strong>{money(r.total)}</strong>
        </div>
      ))}
    </article>
  );
}
function Payments({ rows }: { rows: any }) {
  const all =
    (rows?.paid?.count || 0) +
      (rows?.partial?.count || 0) +
      (rows?.pending?.count || 0) || 1;
  const p = rows || {
    paid: { count: 0, total: 0 },
    partial: { count: 0, total: 0 },
    pending: { count: 0, total: 0 },
  };
  return (
    <article className="si-chart">
      <h3>
        <PieChart />
        Estado de pago
      </h3>
      <div className="si-payment">
        <div
          className="si-donut"
          style={{
            background: `conic-gradient(#20a36a 0 ${(p.paid.count / all) * 100}%,#e3a62d ${(p.paid.count / all) * 100}% ${((p.paid.count + p.partial.count) / all) * 100}%,#d9534f ${((p.paid.count + p.partial.count) / all) * 100}% 100%)`,
          }}
        >
          <b>{all}</b>
          <small>facturas</small>
        </div>
        <p>
          ● Pagadas: {p.paid.count}
          <br />● Parciales: {p.partial.count}
          <br />● Pendientes: {p.pending.count}
        </p>
      </div>
    </article>
  );
}
function Detail({
  i,
  base,
  close,
}: {
  i: I;
  base: string | null;
  close: () => void;
}) {
  const rows = (a: string, b: string) => (
    <div key={a}>
      <dt>{a}</dt>
      <dd>{b}</dd>
    </div>
  );
  return (
    <div
      className="si-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <aside className="si-drawer">
        <button className="si-close" onClick={close}>
          <X />
        </button>
        <p className="eyebrow">Detalle de factura</p>
        <h2>{i.ref || i.name}</h2>
        <Badge t="state" v={i.state} />
        <Badge t="payment" v={i.paymentState} />
        <section>
          <h3>Datos generales</h3>
          <dl>
            {rows("Proveedor", i.partnerName)}
            {rows("NIF/VAT", i.partnerVat || "—")}
            {rows("País", i.partnerCountry || "—")}
            {rows("Nº factura proveedor", i.ref || "—")}
            {rows("Nº interno Odoo", i.name)}
            {rows("Fecha factura", d(i.invoiceDate))}
            {rows("Fecha contable", d(i.accountingDate))}
            {rows("Vencimiento", d(i.dueDate))}
            {rows("Moneda", i.currency || "—")}
            {rows("Diario", i.journal || "—")}
            {rows("Referencia", i.invoiceOrigin || "—")}
          </dl>
        </section>
        <section>
          <h3>Importes</h3>
          <dl>
            {rows(
              "Base imponible",
              money(i.amountUntaxed, i.currency || "EUR"),
            )}
            {rows("Impuestos", money(i.amountTax, i.currency || "EUR"))}
            {rows(
              "Tratamiento fiscal",
              i.fiscalPosition || i.taxSummary.join(", ") || "—",
            )}
            {rows("Total", money(i.amountTotal, i.currency || "EUR"))}
            {rows("Pendiente", money(i.amountResidual, i.currency || "EUR"))}
            {rows("Pagado", money(i.amountPaid, i.currency || "EUR"))}
          </dl>
        </section>
        <section>
          <h3>Relación con compras</h3>
          <dl>
            {rows(
              "Pedido compra",
              i.linkedPurchaseOrderNames.join(", ") || "No disponible",
            )}
            {rows(
              "Recepción",
              i.linkedPickingNames.join(", ") || "No disponible",
            )}
          </dl>
          {base && (
            <a
              className="si-odoo"
              target="_blank"
              rel="noreferrer"
              href={`${base}/web#id=${i.id}&model=account.move&view_type=form`}
            >
              <ExternalLink />
              Abrir en Odoo
            </a>
          )}
        </section>
        <section>
          <h3>Líneas de factura</h3>
          <div className="si-lines">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Precio</th>
                  <th>Dto.</th>
                  <th>Impuesto</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {i.lines
                  .filter((l) => l.displayType === "product")
                  .map((l, n) => (
                    <tr key={n}>
                      <td>
                        {l.productName || l.name}
                        <small>{l.productRef || ""}</small>
                      </td>
                      <td>{l.quantity}</td>
                      <td>{money(l.priceUnit, i.currency || "EUR")}</td>
                      <td>{l.discount || "—"}</td>
                      <td>{l.taxNames.join(", ") || "—"}</td>
                      <td>{money(l.total, i.currency || "EUR")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
          <section>
            <h3>Documentación</h3>
            <dl>
            {rows("Tiene PDF", i.hasPdf ? "Sí" : "No")}
            {rows("Número de adjuntos", String(i.attachments.length))}
            {rows(
              "Estado de sincronización",
              i.lastSyncAt
                ? `Sincronizado ${d(i.lastSyncAt.slice(0, 10))}`
                : "Pendiente",
              )}
            </dl>
            {i.attachments.length > 0 && (
              <div className="si-attachments">
                {i.attachments.map((attachment: any) => (
                  <a key={attachment.id} target="_blank" rel="noreferrer" href={api(`/api/odoo/supplier-invoices/attachment?invoiceId=${i.id}&id=${attachment.id}`)}>
                    <ExternalLink /> {attachment.name}
                  </a>
                ))}
              </div>
            )}
          </section>
      </aside>
    </div>
  );
}
