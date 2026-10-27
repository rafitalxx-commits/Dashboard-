import { useEffect, useState } from "react";
import { ArrowUpRight, Boxes, ClipboardList, PackageCheck, Printer, RefreshCw, ShoppingCart, Truck } from "lucide-react";
import { odooClient } from "../../services/odooClient";
import type { OperationalHomeMetric, OperationalHomePayload } from "../../services/odooTypes";
import { HomeComparison } from "./HomeComparison";
import "./home.css";

let recentHome: { expiresAt: number; data: OperationalHomePayload } | null = null;
const operationalCards: Array<{ key: OperationalHomeMetric; title: string; detail: string; icon: typeof Printer }> = [
  { key: "unprinted", title: "Pedidos sin imprimir", detail: "4 días · FBM + Website", icon: Printer },
  { key: "unsent", title: "Pedidos sin enviar", detail: "4 días · entrega Odoo pendiente", icon: Truck },
  { key: "receptions", title: "Recepciones", detail: "Pendiente + Esperando", icon: PackageCheck },
  { key: "underOrder", title: "Compras Bajo pedido", detail: "Necesidades de clientes", icon: ShoppingCart },
  { key: "noStock", title: "Productos sin stock", detail: "ALM/Stock ≤ 0 · zona predeterminada · sin kits/Bajo pedido", icon: Boxes },
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
    <HomeSection title="Operativa inmediata" className="operational-home-grid operational-home-grid--primary">{renderCard("unprinted")}{renderCard("unsent")}{renderCard("receptions")}{renderCard("underOrder")}</HomeSection>
    <HomeComparison refreshId={refreshId}/>
    <HomeSection title="Necesidades y actuación" className="operational-home-grid">{renderCard("noStock")}{renderCard("pendingPurchases")}</HomeSection>
  </main>;
}

function HomeSection({ title, className, children }: { title: string; className: string; children: React.ReactNode }) {
  return <section className="operational-home-section"><h2>{title}</h2><div className={className}>{children}</div></section>;
}

function OperationalKpiCard({ card, metric, loading, onClick }: { card: typeof operationalCards[number]; metric?: { count?: number; error?: string }; loading: boolean; onClick: () => void }) {
  const Icon = card.icon;
  return <button className="operational-home-kpi" onClick={onClick} type="button"><span className="operational-home-kpi-top"><span className="operational-home-icon"><Icon size={20}/></span><ArrowUpRight size={18} className="operational-home-arrow"/></span><span className="operational-home-kpi-title">{card.title}</span>{loading ? <span className="operational-home-skeleton number"/> : metric?.error ? <span className="operational-home-kpi-unavailable">Sin dato</span> : <strong>{metric?.count === undefined ? "—" : new Intl.NumberFormat("es-ES").format(metric.count)}</strong>}<small>{metric?.error ? "No se pudo consultar este origen" : card.detail}</small></button>;
}
