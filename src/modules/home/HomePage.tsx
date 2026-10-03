import { useEffect, useState } from "react";
import { ArrowUpRight, Boxes, ClipboardList, PackageCheck, Printer, RefreshCw, ShoppingCart, Truck, Warehouse } from "lucide-react";
import { odooClient } from "../../services/odooClient";
import type { OperationalHomeChart, OperationalHomeMetric, OperationalHomePayload, OperationalHomePeriod } from "../../services/odooTypes";
import "./home.css";

let recentHome: { expiresAt: number; data: OperationalHomePayload } | null = null;
const operationalCards: Array<{ key: OperationalHomeMetric; title: string; detail: string; icon: typeof Printer }> = [
  { key: "unprinted", title: "Pedidos sin imprimir", detail: "4 días · FBM + Website", icon: Printer },
  { key: "unsent", title: "Pedidos sin enviar", detail: "4 días · sin etiqueta", icon: Truck },
  { key: "receptions", title: "Recepciones", detail: "Pendiente + Esperando", icon: PackageCheck },
  { key: "underOrder", title: "Compras Bajo pedido", detail: "Necesidades de clientes", icon: ShoppingCart },
  { key: "noStock", title: "Productos sin stock", detail: "Ubicaciones · sin Bajo pedido", icon: Boxes },
  { key: "pendingPurchases", title: "Compras pendientes", detail: "Presupuestos Odoo", icon: ClipboardList },
];

export function HomePage({ onOpen }: { onOpen: (metric: OperationalHomeMetric, ids: string[], range: { from: string; to: string }) => void }) {
  const [data, setData] = useState<OperationalHomePayload | null>(() => recentHome && recentHome.expiresAt > Date.now() ? recentHome.data : null);
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState("");
  const [refreshId, setRefreshId] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const refreshIfStale = () => {
      if (document.visibilityState === "visible" && (!recentHome || recentHome.expiresAt <= Date.now())) {
        setRefreshId((id) => id + 1);
      }
    };
    const timer = window.setInterval(refreshIfStale, 60_000);
    document.addEventListener("visibilitychange", refreshIfStale);
    window.addEventListener("focus", refreshIfStale);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfStale);
      window.removeEventListener("focus", refreshIfStale);
    };
  }, []);
  useEffect(() => {
    if (data && recentHome && recentHome.expiresAt > Date.now() && refreshId === 0) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void odooClient.getOperationalHome(refreshId > 0, controller.signal).then((value) => {
      recentHome = { data: value, expiresAt: Date.now() + 45_000 };
      setData(value);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo actualizar Inicio");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshId]);
  const seconds = data ? Math.max(0, Math.floor((now - new Date(data.updatedAt).getTime()) / 1000)) : null;
  const renderCard = (key: OperationalHomeMetric) => {
    const card = operationalCards.find((item) => item.key === key)!;
    return <OperationalKpiCard key={key} card={card} metric={data?.values[key]} loading={loading && !data} onClick={() => { if (data && !data.values[key].error) onOpen(key, data.values[key].ids || [], data.range); }} />;
  };
  return <main className="operational-home">
    <header className="operational-home-header"><div><span className="operational-home-eyebrow">Panel operativo</span><h1>Inicio</h1><p>Lo que necesita atención, de un vistazo.</p></div><button className="operational-home-refresh" disabled={loading} onClick={() => setRefreshId((id) => id + 1)} type="button"><RefreshCw aria-hidden="true" className={loading ? "spinning" : ""} size={16}/>{loading ? "Actualizando…" : seconds === null ? "Actualizar" : `Actualizado hace ${seconds} s`}</button></header>
    {error && <p className="operational-home-error" role="alert">{error} <button onClick={() => setRefreshId((id) => id + 1)} type="button">Reintentar</button></p>}
    <HomeSection title="Operativa inmediata" className="operational-home-grid">{renderCard("unprinted")}{renderCard("unsent")}{renderCard("receptions")}</HomeSection>
    <HomeSection title="Actividad y rendimiento" className="operational-home-charts"><ChartCard kind="shipments" title="Pedidos enviados" refreshId={refreshId}/><ChartCard kind="sales" title="Ventas" refreshId={refreshId}/></HomeSection>
    <HomeSection title="Necesidades y actuación" className="operational-home-grid">{renderCard("underOrder")}{renderCard("noStock")}{renderCard("pendingPurchases")}</HomeSection>
  </main>;
}

function HomeSection({ title, className, children }: { title: string; className: string; children: React.ReactNode }) {
  return <section className="operational-home-section"><h2>{title}</h2><div className={className}>{children}</div></section>;
}

function OperationalKpiCard({ card, metric, loading, onClick }: { card: typeof operationalCards[number]; metric?: { count?: number; error?: string }; loading: boolean; onClick: () => void }) {
  const Icon = card.icon;
  return <button className="operational-home-kpi" onClick={onClick} type="button"><span className="operational-home-kpi-top"><span className="operational-home-icon"><Icon size={20}/></span><ArrowUpRight size={18} className="operational-home-arrow"/></span><span className="operational-home-kpi-title">{card.title}</span>{loading ? <span className="operational-home-skeleton number"/> : metric?.error ? <span className="operational-home-kpi-unavailable">Sin dato</span> : <strong>{metric?.count === undefined ? "—" : new Intl.NumberFormat("es-ES").format(metric.count)}</strong>}<small>{metric?.error ? "No se pudo consultar este origen" : card.detail}</small></button>;
}

function ChartCard({ kind, title, refreshId }: { kind: "shipments" | "sales"; title: string; refreshId: number }) {
  const [period, setPeriod] = useState<OperationalHomePeriod>("48h");
  const [channel, setChannel] = useState("all");
  const [chart, setChart] = useState<OperationalHomeChart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void odooClient.getOperationalHomeChart(kind, period, channel, refreshId > 0, controller.signal).then(setChart).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo cargar la gráfica");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, period, channel, refreshId]);
  const total = kind === "sales" ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(chart?.total || 0) : new Intl.NumberFormat("es-ES").format(chart?.total || 0);
  const max = Math.max(1, ...(chart?.points.map((point) => point.value) || []));
  return <article className="operational-home-chart"><div className="operational-home-chart-heading"><span className="operational-home-icon">{kind === "sales" ? <ShoppingCart size={20}/> : <Warehouse size={20}/>}</span><h3>{title}</h3></div>{loading && !chart ? <><span className="operational-home-skeleton total"/><span className="operational-home-skeleton graph"/></> : <><strong className="operational-home-chart-total">{total}</strong><small>{kind === "sales" ? "Sin impuestos · EUR" : "Etiquetas generadas en Expediciones"}</small></>}
    <div className="operational-home-chart-controls"><PeriodSelector value={period} onChange={setPeriod}/>{kind === "sales" && <label className="operational-home-channel">Canal <select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">Todos</option><option value="fbm">FBM</option><option value="fba">FBA</option><option value="website">Website</option><option value="sales">Sales</option></select></label>}</div>
    {error ? <p className="operational-home-chart-error" role="alert">{error}</p> : <div aria-label={`Evolución de ${title.toLowerCase()}`} className="operational-home-chart-scroll"><div className="operational-home-bars" aria-busy={loading}>{(chart?.points || []).map((point, index) => <div className="operational-home-bar" key={point.at} title={`${point.at}: ${point.value}`}><span style={{ height: `${Math.max(point.value ? 5 : 2, (point.value / max) * 100)}%` }} /><small>{index % (period === "48h" ? 6 : period === "day" ? 3 : 1) === 0 ? point.at.slice(period === "48h" || period === "day" ? -2 : 5) : ""}</small></div>)}</div></div>}
  </article>;
}

function PeriodSelector({ value, onChange }: { value: OperationalHomePeriod; onChange: (period: OperationalHomePeriod) => void }) {
  const periods: Array<[OperationalHomePeriod, string]> = [["48h", "48H"], ["day", "Día"], ["week", "Semana"], ["month", "Mes"]];
  return <div aria-label="Periodo" className="operational-home-period">{periods.map(([id, label]) => <button aria-pressed={value === id} className={value === id ? "active" : ""} key={id} onClick={() => onChange(id)} type="button">{label}</button>)}</div>;
}
