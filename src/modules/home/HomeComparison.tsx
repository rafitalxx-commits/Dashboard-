import { useEffect, useRef, useState } from "react";
import { odooClient } from "../../services/odooClient";
import type { OperationalHomeComparison, OperationalHomeComparisonBucket } from "../../services/odooTypes";
import "./homeComparison.css";


type Granularity = "hour" | "day" | "month";
type RangeMode = "day" | "week" | "month" | "year" | "custom";
type Channel = "fbm" | "website";
type Kind = "orders" | "sales";
const integer = new Intl.NumberFormat("es-ES");
const euro = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const dateKey = (date = new Date()) => { const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((part) => [part.type, part.value])); return parts.year + "-" + parts.month + "-" + parts.day; };
const valueFor = (bucket: OperationalHomeComparisonBucket, kind: Kind, channel: Channel) => bucket[channel + (kind === "orders" ? "Orders" : "Sales")];

export function HomeComparison({ refreshId }: { refreshId: number }) {
  const today = dateKey();
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [rangeMode, setRangeMode] = useState<RangeMode>("month");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [enabled, setEnabled] = useState<Record<Channel, boolean>>({ fbm: true, website: true });
  const [selected, setSelected] = useState<number | null>(null);
  const [data, setData] = useState<OperationalHomeComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [todayKey, setTodayKey] = useState(today);
  const lastRefreshId = useRef(refreshId);
  const [hover, setHover] = useState<{ x: number; y: number; index: number; kind: Kind } | null>(null);
  useEffect(() => {
    const checkDate = () => setTodayKey(dateKey());
    const timer = window.setInterval(checkDate, 60_000);
    window.addEventListener("focus", checkDate);
    document.addEventListener("visibilitychange", checkDate);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", checkDate); document.removeEventListener("visibilitychange", checkDate); };
  }, []);
  const todayDate = new Date(todayKey + "T00:00:00Z");
  const weekOffset = (todayDate.getUTCDay() + 6) % 7;
  const weekStart = new Date(todayDate.getTime() - weekOffset * 86_400_000).toISOString().slice(0, 10);
  const range = rangeMode === "custom"
    ? { from: customFrom, to: customTo }
    : rangeMode === "year"
      ? { from: year + "-01-01", to: year === Number(todayKey.slice(0, 4)) ? todayKey : year + "-12-31" }
      : rangeMode === "day"
        ? { from: todayKey, to: todayKey }
        : rangeMode === "week"
          ? { from: weekStart, to: todayKey }
          : { from: todayKey.slice(0, 7) + "-01", to: todayKey };
  const rangeDays = (Date.parse(range.to + "T00:00:00Z") - Date.parse(range.from + "T00:00:00Z")) / 86_400_000 + 1;
  const rangeIssue = rangeMode === "custom" && (!range.from || !range.to) ? "Selecciona las dos fechas del intervalo." : range.from > range.to ? "La fecha «Hasta» debe ser igual o posterior a «Desde»." : rangeDays > 3660 ? "El rango máximo es de 10 años." : "";
  const rangeKey = range.from + ":" + range.to;
  const visibleData = data?.range.from === range.from && data.range.to === range.to ? data : null;
  const isLoading = loading || (!visibleData && !rangeIssue && !error);
  useEffect(() => {
    if (rangeIssue) { setLoading(false); setError(rangeIssue); return; }
    const controller = new AbortController();
    const forceRefresh = refreshId !== lastRefreshId.current;
    lastRefreshId.current = refreshId;
    setLoading(true); setError("");
    void odooClient.getOperationalHomeComparison(range, forceRefresh, controller.signal)
      .then((value) => { setData(value); setSelected(null); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo cargar el comparativo"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // data is intentionally excluded: a successful response must not trigger a fetch loop.
  }, [rangeKey, refreshId, todayKey, rangeIssue]);
  const buckets = visibleData?.buckets || [];
  const changeMode = (value: RangeMode) => { setRangeMode(value); setSelected(null); setHover(null); };
  const changeYear = (value: number) => { setYear(value); setRangeMode("year"); setSelected(null); setHover(null); };
  const subtitleText = rangeMode === "day" ? "Hoy · agrupado por hora"
    : rangeMode === "week" ? "Semana actual · lunes a hoy"
      : rangeMode === "month" ? "Mes actual · del día 1 a hoy"
        : rangeMode === "year" ? "Año " + year + " · " + range.from + " a " + range.to
          : range.from + " a " + range.to;
  const toggle = (channel: Channel) => { setEnabled((current) => ({ ...current, [channel]: !current[channel] })); setHover(null); };
  return <section className="operational-home-section home-comparison" aria-label="Actividad y rendimiento" aria-busy={isLoading}>
    <div className="home-comparison-head"><div><h2>Actividad y rendimiento</h2><p className="home-comparison-range-caption">Pedidos enviados y ventas según su primera entrega completada.</p></div></div>
    <div className="home-comparison-filters" aria-label="Filtrar actividad por fecha">
      <div className="home-comparison-segmented" role="group" aria-label="Periodo de actividad">{([["day", "Día"], ["week", "Semana"], ["month", "Mes"], ["year", "Año"], ["custom", "Desde–hasta"]] as Array<[RangeMode, string]>).map(([value, label]) => <button aria-pressed={rangeMode === value} className={rangeMode === value ? "active" : ""} key={value} onClick={() => changeMode(value)} type="button">{label}</button>)}</div>
      {rangeMode === "year" && <label>Año<select aria-label="Año" value={year} onChange={(event) => changeYear(Number(event.target.value))}>{Array.from({ length: Math.max(1, currentYear - 2017 + 1) }, (_, index) => currentYear - index).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
      {rangeMode === "custom" && <div className="home-comparison-date-range"><label>Desde<input aria-label="Fecha desde" type="date" value={customFrom} max={todayKey} onChange={(event) => { setCustomFrom(event.target.value); setSelected(null); }}/></label><span aria-hidden="true">—</span><label>Hasta<input aria-label="Fecha hasta" type="date" value={customTo} min={customFrom || undefined} max={todayKey} onChange={(event) => { setCustomTo(event.target.value); setSelected(null); }}/></label></div>}
      <span className="home-comparison-range-status" role="status">{isLoading ? "Cargando periodo…" : visibleData ? buckets.length + (buckets.length === 1 ? " intervalo · actualizado " : " intervalos · actualizado ") + new Date(visibleData.updatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
    </div>
    {(error || rangeIssue) && <p className="operational-home-chart-error" role="alert">{error || rangeIssue}</p>}
    <div className="home-comparison-grid">
      <ComparisonCard kind="orders" title="Pedidos enviados" buckets={buckets} granularity={visibleData?.granularity || "day"} subtitleText={subtitleText} enabled={enabled} onToggle={toggle} selected={selected} onSelect={setSelected} loading={isLoading} unavailable={Boolean((error || rangeIssue) && !visibleData)} onHover={setHover}/>
      <ComparisonCard kind="sales" title="Ventas sin IVA" buckets={buckets} granularity={visibleData?.granularity || "day"} subtitleText={subtitleText} enabled={enabled} onToggle={toggle} selected={selected} onSelect={setSelected} loading={isLoading} unavailable={Boolean((error || rangeIssue) && !visibleData)} onHover={setHover}/>
    </div>
    {hover && buckets[hover.index] && <div className="home-comparison-tooltip" style={{ left: Math.max(8, Math.min(hover.x + 12, window.innerWidth - 220)), top: Math.max(8, Math.min(hover.y + 12, window.innerHeight - 120)) }} role="tooltip"><b>{buckets[hover.index].label}</b><br/>FBM: {format(valueFor(buckets[hover.index], hover.kind, "fbm") * Number(enabled.fbm), hover.kind)}<br/>Website: {format(valueFor(buckets[hover.index], hover.kind, "website") * Number(enabled.website), hover.kind)}<br/>Total: {format(totalFor(buckets[hover.index], hover.kind, enabled), hover.kind)}</div>}
  </section>;
}

function format(value: number, kind: Kind) { return kind === "sales" ? euro.format(value) : integer.format(value); }
function totalFor(bucket: OperationalHomeComparisonBucket, kind: Kind, enabled: Record<Channel, boolean>) { return (enabled.fbm ? valueFor(bucket, kind, "fbm") : 0) + (enabled.website ? valueFor(bucket, kind, "website") : 0); }

function ComparisonCard({ kind, title, buckets, granularity, subtitleText, enabled, onToggle, selected, onSelect, loading, unavailable, onHover }: {
  kind: Kind; title: string; buckets: OperationalHomeComparisonBucket[]; granularity: Granularity; subtitleText: string;
  enabled: Record<Channel, boolean>; onToggle: (channel: Channel) => void; selected: number | null;
  onSelect: (index: number | null) => void; loading: boolean; unavailable: boolean;
  onHover: (value: { x: number; y: number; index: number; kind: Kind } | null) => void;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  useEffect(() => {
    const node = plotRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(200, Math.round(node.clientWidth))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const sum = (channel: Channel) => buckets.reduce((value, bucket) => value + valueFor(bucket, kind, channel), 0);
  const fbm = enabled.fbm ? sum("fbm") : 0;
  const website = enabled.website ? sum("website") : 0;
  const total = fbm + website;
  const values = buckets.map((bucket) => totalFor(bucket, kind, enabled));
  const peak = Math.max(0, ...values);
  const peakIndex = values.findIndex((value) => value === peak);
  const selectedValue = selected === null ? total : values[selected] ?? 0;
  const meterPercent = selected === null ? (total ? 100 : 0) : peak ? Math.min(100, selectedValue / peak * 100) : 0;
  const W = width, H = width <= 350 ? 250 : 300, L = 35, R = 10, top = 15, bottom = 35;
  const plotWidth = W - L - R, plotHeight = H - top - bottom;
  const max = Math.max(1, ...values);
  const slot = plotWidth / Math.max(1, buckets.length);
  const barWidth = Math.max(5, slot - Math.min(8, slot * .28));
  const labelStride = granularity === "hour" ? (W < 360 ? 4 : W < 520 ? 3 : 1) : granularity === "month" ? Math.max(1, Math.ceil(buckets.length / (W < 520 ? 6 : 12))) : (W < 360 ? 5 : W < 520 ? 4 : 2);
  return <article className="home-comparison-card">
    <div className="home-comparison-top"><div><h3>{title}</h3>{loading ? <span className="operational-home-skeleton total"/> : <strong className="home-comparison-big">{unavailable ? "Sin dato" : format(total, kind)}</strong>}<span className="home-comparison-unit">{subtitleText}</span></div><div className="home-comparison-legend">{(["fbm", "website"] as Channel[]).map((channel) => <button key={channel} className={`home-comparison-chip ${enabled[channel] ? "" : "off"}`} type="button" aria-pressed={enabled[channel]} onClick={() => onToggle(channel)}><span className={`home-comparison-dot ${channel}`}/>{channel === "fbm" ? "FBM" : "Website"}</button>)}</div></div>
    <div className="home-comparison-chartrow"><div ref={plotRef} className="home-comparison-plot" onClick={() => onSelect(null)}>{loading ? <span className="operational-home-skeleton graph"/> : unavailable ? <div className="home-comparison-empty">No se pudieron leer los datos.</div> : <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: barras apiladas FBM y Website por ${granularity === "hour" ? "hora" : granularity === "month" ? "mes" : "día"}`}>
      {Array.from({ length: 5 }, (_, index) => { const y = top + plotHeight * index / 4; return <line key={index} className="home-comparison-gridline" x1={L} x2={W-R} y1={y} y2={y}/>; })}
      {buckets.map((bucket, index) => { const x = L + index * slot + (slot - barWidth) / 2; const fbmValue = enabled.fbm ? valueFor(bucket, kind, "fbm") : 0; const webValue = enabled.website ? valueFor(bucket, kind, "website") : 0; const fbmHeight = plotHeight * fbmValue / max; const webHeight = plotHeight * webValue / max; const base = top + plotHeight; const showLabel = index % labelStride === 0 || index === buckets.length - 1; return <g key={bucket.key} className={`home-comparison-column ${selected === index ? "selected" : ""}`} role="button" tabIndex={0} aria-pressed={selected === index} aria-label={`${bucket.label}: ${format(values[index], kind)}`} onFocus={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onHover({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, index, kind }); }} onBlur={() => onHover(null)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(index); } }} onClick={(event) => { event.stopPropagation(); onSelect(selected === index ? null : index); }} onMouseMove={(event) => onHover({ x: event.clientX, y: event.clientY, index, kind })} onMouseLeave={() => onHover(null)}>
        {fbmHeight > 0 && <rect className="home-comparison-bar" x={x} y={base-fbmHeight} width={barWidth} height={fbmHeight} rx="3" fill="var(--home-fbm)"/>}
        {webHeight > 0 && <rect className="home-comparison-bar" x={x} y={base-fbmHeight-webHeight} width={barWidth} height={webHeight} rx="3" fill="var(--home-website)"/>}
        {selected === index && <rect className="home-comparison-highlight" x={x-2} y={top} width={barWidth+4} height={plotHeight} rx="5"/>}
        <rect className="home-comparison-hit" x={L+index*slot} y={top} width={slot} height={plotHeight} fill="transparent"/>
        {showLabel && <text className="home-comparison-axis" textAnchor="middle" x={x+barWidth/2} y={H-10}>{bucket.label}</text>}
      </g>; })}
    </svg>}</div><div className="home-comparison-meter" aria-label={loading || unavailable ? "Dato no disponible" : selected === null ? `Total del periodo: ${format(total, kind)}` : `${buckets[selected]?.label}: ${format(selectedValue, kind)}`}><div className="home-comparison-meter-track"><div className="home-comparison-meter-fill" style={{ height: `${loading || unavailable ? 0 : meterPercent}%` }}/></div><span className="home-comparison-meter-value">{selected !== null && <small>{buckets[selected]?.label}</small>}{loading || unavailable ? "—" : format(selectedValue, kind)}</span></div></div>
    <div className="home-comparison-breakdown"><div className="home-comparison-mini"><b>{loading || unavailable ? "—" : format(fbm, kind)}</b><small>FBM</small></div><div className="home-comparison-mini"><b>{loading || unavailable ? "—" : format(website, kind)}</b><small>Website</small></div><div className="home-comparison-mini"><b>{!loading && !unavailable && peakIndex >= 0 ? `${buckets[peakIndex].label} · ${format(peak, kind)}` : "—"}</b><small>Máximo intervalo</small></div></div>
    <p className="home-comparison-note">{kind === "orders" ? "Haz clic en una barra para fijar el detalle del intervalo. Vuelve a hacer clic fuera para limpiar." : "Misma lógica temporal y mismos canales que pedidos para comparar volumen e importe."}</p>
  </article>;
}
