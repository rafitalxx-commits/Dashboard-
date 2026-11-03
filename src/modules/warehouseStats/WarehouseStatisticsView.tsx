import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChartPie, PackageCheck, RefreshCw, Users } from "lucide-react";
import { downloadWorkerQr, workerQrDataUrl } from "../expeditions/workerQr";
import { activeHourKeys, weekDayRows, bucketOrders, localDate, orderReference, periodFor, TIME_ZONE, uniqueOrders, withinPeriod, workerRoster, type Activity, type Bucket, type Range, type Worker } from "./statistics";
import "../home/homeComparison.css";
import "./warehouseStatistics.css";

const labels: Record<Range, string> = { today: "Hoy", week: "7 días", month: "Mes" };
const integer = new Intl.NumberFormat("es-ES");
const percent = new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 1 });
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("es-ES", { timeZone: TIME_ZONE, day: "numeric", month: "long" });
const isLab = () => /^\/expeditions-(?:lab|redesign-lab)(?:\/|$)/.test(window.location.pathname);
const apiPath = (path: string) => { const match = window.location.pathname.match(/^\/(expeditions-(?:lab|redesign-lab))(?=\/|$)/); return match ? `/${match[1]}${path}` : path; };

export function WarehouseStatisticsView() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [range, setRange] = useState<Range>("today");
  const [month, setMonth] = useState(() => localDate(new Date())!.day.slice(0, 7));
  const [worker, setWorker] = useState("all");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedHour, setSelectedHour] = useState<string | null>(null);
  const [refreshId, setRefreshId] = useState(0);
  const [detailPage, setDetailPage] = useState(1);
  useEffect(() => setDetailPage(1), [range, month, worker, selectedDay, selectedHour, refreshId]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [qrDataUrl, setQrDataUrl] = useState("");
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const read = async (path: string) => {
      const response = await fetch(apiPath(path), { signal: controller.signal });
      if (!response.ok) throw new Error(`No se pudieron cargar las estadísticas (HTTP ${response.status}). Pulsa Actualizar para reintentar.`);
      return response.json();
    };
    void Promise.all([read("/api/warehouse-workers/statistics"), read("/api/warehouse-workers/statistics/workers")])
      .then(([stats, people]) => {
        if (!Array.isArray(stats.activities) || !Array.isArray(people.workers)) throw new Error("La respuesta de estadísticas no es válida.");
        if (!controller.signal.aborted) { setActivities(stats.activities); setWorkers(people.workers); setUpdatedAt(new Date()); setNow(new Date()); }
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudieron cargar las estadísticas."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshId]);
  const roster = useMemo(() => workerRoster(workers, activities), [workers, activities]);
  const selectedWorker = roster.find(item => item.id === worker) || null;
  useEffect(() => {
    let active = true;
    setQrDataUrl("");
    if (selectedWorker) void workerQrDataUrl(selectedWorker).then(value => { if (active) setQrDataUrl(value); }).catch(() => {});
    return () => { active = false; };
  }, [selectedWorker]);
  const period = periodFor(range, month, now);
  const orders = useMemo(() => uniqueOrders(activities, now), [activities, now]);
  const periodOrders = useMemo(() => withinPeriod(orders, period, worker), [orders, period.from, period.to, worker]);
  const daily = useMemo(() => bucketOrders(periodOrders, "day", period), [periodOrders, period.from, period.to]);
  const dayOrders = selectedDay ? periodOrders.filter(item => localDate(item.createdAt)?.day === selectedDay) : periodOrders;
  const filtered = selectedHour ? dayOrders.filter(item => localDate(item.createdAt)?.hour === selectedHour) : dayOrders;
  const kind = range === "month" && !selectedDay ? "day" : "hour";
  const buckets = bucketOrders(dayOrders, kind, period);
  const weeklyOverview = range === "week" && !selectedDay;
  const weekRows = useMemo(() => range === "week" ? weekDayRows(periodOrders, period) : [], [range, periodOrders, period.from, period.to]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(detailPage, pageCount);
  const visibleOrders = filtered.slice().reverse().slice((currentPage - 1) * 50, currentPage * 50);
  const counts = new Map<string, number>();
  filtered.forEach(item => counts.set(item.workerId, (counts.get(item.workerId) || 0) + 1));
  const byWorker = roster.filter(item => counts.has(item.id)).map(item => ({ ...item, total: counts.get(item.id)! })).sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  const realLabels = withinPeriod(activities.filter(item => item.result === "label-created" && Date.parse(item.createdAt) <= now.getTime()), period, worker)
    .filter(item => (!selectedDay || localDate(item.createdAt)?.day === selectedDay) && (!selectedHour || localDate(item.createdAt)?.hour === selectedHour));
  const contextLabel = selectedDay ? dayLabel(selectedDay) : range === "month" ? new Date(`${month}-01T12:00:00Z`).toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: TIME_ZONE }) : range === "week" ? `Últimos 7 días · ${dayLabel(period.from)} – ${dayLabel(period.to)}` : `Hoy · ${dayLabel(period.to)}`;
  const scopeLabel = contextLabel + (selectedHour ? ` · ${selectedHour}:00–${selectedHour}:59` : "");
  const unavailable = loading || Boolean(error);
  const changeRange = (value: Range) => { setRange(value); setSelectedDay(null); setSelectedHour(null); };
  const selectDay = (value: string) => { setSelectedDay(value); setSelectedHour(null); };
  let position = 0;
  const gradient = byWorker.map(item => { const start = position; position += item.total / filtered.length * 100; return `${item.color} ${start}% ${position}%`; }).join(", ");
  const colorById = new Map(roster.map(item => [item.id, item.color]));
  return <section className="warehouse-stats warehouse-stats-v2 home-comparison" aria-label="Estadísticas de Expediciones" aria-busy={loading}>
    <header className="warehouse-stats-hero"><div><span>Estadísticas de Expediciones</span><h2>Actividad por operario</h2><p>Pedidos con etiqueta real registrada por QR. Cada pedido cuenta una sola vez, en su primera etiqueta.</p></div><div className="warehouse-stats-live"><i />{isLab() ? "Copia LAB" : "Datos reales"}<br/><small>{isLab() ? "No modifica el almacén" : "Solo lectura"}</small></div></header>
    <div className="warehouse-stats-controls home-comparison-filters">
      <div className="home-comparison-segmented" role="group" aria-label="Periodo de estadísticas">{(Object.keys(labels) as Range[]).map(key => <button aria-pressed={range === key} className={range === key ? "active" : ""} key={key} onClick={() => changeRange(key)} type="button">{labels[key]}</button>)}</div>
      {range === "month" && <label>Mes<input aria-label="Mes de estadísticas" type="month" max={localDate(now)!.day.slice(0, 7)} value={month} onChange={event => { const value = event.target.value; if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= localDate(now)!.day.slice(0, 7)) { setMonth(value); setSelectedDay(null); setSelectedHour(null); } }}/></label>}
      <label>Operario<select aria-label="Filtrar por operario" onChange={event => setWorker(event.target.value)} value={worker}><option value="all">Todos los operarios</option>{roster.map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}{!item.active ? " (histórico)" : ""}</option>)}</select></label>
      <button className="warehouse-refresh" disabled={loading} onClick={() => setRefreshId(value => value + 1)} type="button"><RefreshCw size={15}/>{loading ? "Cargando…" : "Actualizar"}</button>
      <span className="home-comparison-range-status" role="status">{loading ? "Cargando periodo…" : error ? "Lectura no disponible" : `Actualizado ${updatedAt?.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE })} · hora peninsular`}</span>
    </div>
    {error && <p className="warehouse-stats-error" role="alert">{error}</p>}
    <div className="warehouse-scope"><span>{scopeLabel}{selectedWorker ? ` · ${selectedWorker.name}` : " · Todos los operarios"}</span>{selectedHour && <button type="button" onClick={() => setSelectedHour(null)}>Ver todas las horas</button>}{selectedDay && <button type="button" onClick={() => { setSelectedDay(null); setSelectedHour(null); }}>{range === "week" ? "Volver a los 7 días" : "Volver al mes completo"}</button>}</div>
    <div className="warehouse-kpis">
      <article><span><PackageCheck size={17}/>Pedidos totales</span><strong data-testid="orders-total">{unavailable ? "—" : integer.format(filtered.length)}</strong><small>{selectedHour ? "En la hora seleccionada" : selectedDay ? "En el día seleccionado" : "En el periodo seleccionado"}</small></article>
      <article><span><Users size={17}/>Operarios con actividad</span><strong>{unavailable ? "—" : byWorker.length}</strong><small>Sobre el mismo filtro</small></article>
      <article><span><BarChart3 size={17}/>Etiquetas registradas</span><strong data-testid="labels-total">{unavailable ? "—" : integer.format(realLabels.length)}</strong><small>Incluye etiquetas adicionales del mismo pedido</small></article>
    </div>
    <div className="warehouse-charts">
      <article className="home-comparison-card warehouse-chart-panel">
        <div className="home-comparison-top"><div><h3>Pedidos por {weeklyOverview ? "día y hora" : kind === "day" ? "día" : "hora"}</h3><strong className="home-comparison-big">{unavailable ? "—" : integer.format(dayOrders.length)}</strong><span className="home-comparison-unit">{kind === "day" ? `${contextLabel} · pulsa un día para ver sus horas` : weeklyOverview ? "Últimos 7 días · cada fila muestra las horas de un día" : `${contextLabel} · agrupado por hora`}</span></div><BarChart3 size={21} color="#4f8cff"/></div>
        {unavailable ? <div className="warehouse-chart-placeholder">{loading ? "Cargando actividad…" : "No se pudieron leer los datos."}</div> : weeklyOverview ? <WeekHoursChart rows={weekRows} roster={roster} onSelectDay={selectDay} onSelectHour={(day, hour) => { setSelectedDay(day); setSelectedHour(hour); }}/> : <OrderChart buckets={buckets} roster={roster} kind={kind} selectedHour={selectedHour} onSelect={value => kind === "day" ? selectDay(value) : setSelectedHour(current => current === value ? null : value)}/>}
        <p className="home-comparison-note">{weeklyOverview ? "Sábados y domingos sin actividad ocultos. Pulsa un día o una hora para ver el detalle." : kind === "day" ? "Cada barra es un día. También puedes abrirlo desde el resumen mensual." : "Pulsa una hora para consultar su detalle y el reparto entre operarios. Los colores son los mismos del gráfico circular."}</p>
      </article>
      <article className="home-comparison-card warehouse-share-card" aria-label="Porcentaje por operario">
        <div className="home-comparison-top"><div><h3>Reparto por operario</h3><span className="home-comparison-unit">Porcentaje del total filtrado</span></div><ChartPie size={21} color="#21b987"/></div>
        <div className="warehouse-share-body"><div className="warehouse-donut" role="img" aria-label={unavailable ? "Reparto no disponible" : `${filtered.length} pedidos. ${byWorker.map(item => `${item.name} (${item.code}): ${percent.format(item.total / filtered.length)}`).join(". ") || "Sin actividad"}`} style={{ background: unavailable || !filtered.length ? "#e9eef5" : `conic-gradient(${gradient})` }}><div><strong>{unavailable ? "—" : integer.format(filtered.length)}</strong><small>pedidos</small></div></div>
        {!unavailable && <ul className="warehouse-share-legend">{byWorker.map(item => <li key={item.id} data-worker-id={item.id}><i style={{ background: item.color }}/><span>{item.name}<small>{item.code}</small></span><b>{percent.format(item.total / filtered.length)}<small>{integer.format(item.total)} pedidos</small></b></li>)}</ul>}</div>
        {!unavailable && !filtered.length && <p className="warehouse-no-results">No hay pedidos para este filtro.</p>}
        <p className="home-comparison-note">{selectedWorker ? "Un solo operario seleccionado: su participación es el 100 % cuando hay actividad." : "La suma de los operarios representa el 100 % del filtro; los porcentajes se muestran redondeados."}</p>
      </article>
    </div>
    {range === "month" && <article className="home-comparison-card warehouse-monthly" aria-label="Resumen mensual">
      <div className="warehouse-panel-head"><div><h3>Resumen mensual · {new Date(`${month}-01T12:00:00Z`).toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: TIME_ZONE })}</h3><small>Selecciona un día para consultar sus horas y pedidos.</small></div><b data-testid="month-total">{unavailable ? "—" : integer.format(periodOrders.length)} pedidos en el mes</b></div>
      <div className="table-scroll" role="region" aria-label="Días del mes" tabIndex={0}><table className="orders-table warehouse-month-table"><thead><tr><th>Día</th><th>Pedidos totales</th><th>% del mes</th></tr></thead><tbody>{!unavailable && daily.map(bucket => <tr key={bucket.key} className={selectedDay === bucket.key ? "selected" : ""}><td><button type="button" aria-pressed={selectedDay === bucket.key} onClick={() => selectDay(bucket.key)}>{dayLabel(bucket.key)}</button></td><td>{integer.format(bucket.total)}</td><td>{percent.format(periodOrders.length ? bucket.total / periodOrders.length : 0)}</td></tr>)}</tbody><tfoot><tr><th>Total del mes</th><td>{unavailable ? "—" : integer.format(periodOrders.length)}</td><td>{unavailable ? "—" : periodOrders.length ? "100 %" : "0 %"}</td></tr></tfoot></table></div>
    </article>}
    <article className="home-comparison-card warehouse-detail"><div className="warehouse-panel-head"><div><h3>Detalle de pedidos</h3><small>Primera etiqueta real de cada pedido · {scopeLabel}</small></div><b>{unavailable ? "—" : integer.format(filtered.length)} pedidos</b></div><div className="table-scroll" role="region" aria-label="Pedidos del filtro" tabIndex={0}><table className="orders-table"><thead><tr><th>Fecha y hora</th><th>Operario</th><th>Pedido</th><th>Transportista</th><th>Tracking</th></tr></thead><tbody>{!unavailable && visibleOrders.map(item => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString("es-ES", { timeZone: TIME_ZONE })}</td><td><strong className="warehouse-detail-worker"><i style={{ background: colorById.get(item.workerId) }}/>{roster.find(person => person.id === item.workerId)?.name || item.workerName}</strong><small>{item.workerCode}</small></td><td>{orderReference(item)}</td><td>{item.carrier || "Sin dato"}</td><td>{item.tracking || "Sin dato"}</td></tr>)}{(unavailable || !filtered.length) && <tr><td colSpan={5} className="empty-state">{loading ? "Cargando pedidos…" : error ? "Datos no disponibles. Reintenta la lectura." : "No hay pedidos registrados para este filtro."}</td></tr>}</tbody></table></div>{!unavailable && filtered.length > 50 && <nav className="warehouse-detail-pages" aria-label="Páginas del detalle de pedidos"><span>{(currentPage - 1) * 50 + 1}–{Math.min(currentPage * 50, filtered.length)} de {integer.format(filtered.length)} pedidos</span><button type="button" disabled={currentPage === 1} onClick={() => setDetailPage(currentPage - 1)}>Anterior</button><button type="button" disabled={currentPage === pageCount} onClick={() => setDetailPage(currentPage + 1)}>Siguiente</button></nav>}</article>
    {selectedWorker && <article className="panel warehouse-worker-qr"><div><span>QR DEL OPERARIO</span><h3>{selectedWorker.name}</h3><p>{selectedWorker.code} · 40 × 40 mm · listo para imprimir</p><button onClick={() => void downloadWorkerQr(selectedWorker)} type="button">Descargar QR</button></div>{qrDataUrl ? <img alt={`Código QR de ${selectedWorker.name}`} src={qrDataUrl}/> : <div className="warehouse-qr-loading">Generando QR…</div>}</article>}
  </section>;
}

function OrderChart({ buckets, roster, kind, selectedHour, onSelect }: { buckets: Bucket[]; roster: Array<Worker & { color: string }>; kind: "hour" | "day"; selectedHour: string | null; onSelect: (key: string) => void }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(650);
  useEffect(() => { const node = plotRef.current; if (!node) return; const observer = new ResizeObserver(() => setWidth(Math.max(200, node.clientWidth))); observer.observe(node); return () => observer.disconnect(); }, []);
  const W = width, H = W < 350 ? 190 : 210, L = 32, R = 8, top = 18, bottom = 32;
  const plotHeight = H - top - bottom, peak = Math.max(1, ...buckets.map(bucket => bucket.total));
  const tickStep = Math.max(1, Math.ceil(peak / 4)), max = Math.ceil(peak / tickStep) * tickStep;
  const ticks = Array.from({ length: max / tickStep + 1 }, (_, index) => index * tickStep / max);
  const slot = (W - L - R) / Math.max(1, buckets.length), barWidth = slot * .72;
  const stride = Math.ceil(buckets.length / (W < 400 ? 6 : 12));
  return <div ref={plotRef} className="home-comparison-plot warehouse-order-plot"><svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Pedidos por ${kind === "day" ? "día" : "hora"}`}>
    {ticks.map(ratio => <g key={ratio}><line className="home-comparison-gridline" x1={L} x2={W - R} y1={top + plotHeight * ratio} y2={top + plotHeight * ratio}/><text className="home-comparison-axis" x={L - 7} y={top + plotHeight * ratio + 4} textAnchor="end">{integer.format(Math.round(max * (1 - ratio)))}</text></g>)}
    {buckets.map((bucket, index) => {
      let base = H - bottom;
      const x = L + index * slot + (slot - barWidth) / 2;
      return <g key={bucket.key} className="home-comparison-column" role="button" tabIndex={0} aria-label={`${kind === "day" ? dayLabel(bucket.key) : bucket.label}: ${bucket.total} pedidos`} aria-pressed={selectedHour === bucket.key} onClick={() => onSelect(bucket.key)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(bucket.key); } }}>
        <title>{kind === "day" ? dayLabel(bucket.key) : bucket.label}: {bucket.total} pedidos{roster.filter(person => bucket.workers[person.id]).map(person => `\n${person.name} (${person.code}): ${bucket.workers[person.id]}`).join("")}</title>
        {roster.map(person => { const height = (bucket.workers[person.id] || 0) / max * plotHeight; base -= height; return height > 0 ? <rect key={person.id} data-worker-id={person.id} className="home-comparison-bar" x={x} y={base} width={barWidth} height={height} fill={person.color} rx={2}/> : null; })}
        <rect className={`warehouse-bar-focus ${selectedHour === bucket.key ? "is-selected" : ""}`} x={L + index * slot} y={top} width={slot} height={plotHeight} rx={4}/>
        {index % stride === 0 && <text className="home-comparison-axis" textAnchor="middle" x={x + barWidth / 2} y={H - 10}>{kind === "hour" && W < 400 ? `${bucket.key}h` : bucket.label}</text>}
      </g>;
    })}
  </svg></div>;
}

function WeekHoursChart({ rows, roster, onSelectDay, onSelectHour }: { rows: ReturnType<typeof weekDayRows>; roster: Array<Worker & { color: string }>; onSelectDay: (day: string) => void; onSelectHour: (day: string, hour: string) => void }) {
  const hours = activeHourKeys(rows);
  const peak = Math.max(1, ...rows.flatMap(day => day.hours.map(hour => hour.total)));
  const style = { gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` };
  return <div className="warehouse-week-hours" aria-label="Horas separadas por día">
    <div className="warehouse-week-axis" aria-hidden="true"><span>Día · pedidos</span><div style={style}>{hours.map((hour, i) => <span key={hour} className={i % (hours.length > 12 ? 3 : hours.length > 7 ? 2 : 1) && i !== hours.length - 1 ? "quiet" : ""}>{hour}h</span>)}</div></div>
    {rows.map(day => <div className="warehouse-week-row" data-day={day.key} data-total={day.total} key={day.key}>
      <button className="warehouse-week-day" type="button" aria-label={`Ver ${dayLabel(day.key)}: ${day.total} pedidos`} onClick={() => onSelectDay(day.key)}><span>{new Date(`${day.key}T12:00:00Z`).toLocaleDateString("es-ES", { timeZone: TIME_ZONE, weekday: "short", day: "numeric" })}</span><b>{integer.format(day.total)}</b>{day.weekend && <small>Excepcional</small>}</button>
      <div className="warehouse-week-bars" role="group" aria-label={`Horas del ${dayLabel(day.key)}`} style={style}>{hours.map(hour => {
        const bucket = day.hours[Number(hour)];
        const description = `${dayLabel(day.key)}, ${hour}:00: ${bucket.total} pedidos`;
        return <button className="warehouse-hour-cell" key={hour} type="button" data-hour={hour} data-total={bucket.total} aria-label={description} title={description + roster.filter(person => bucket.workers[person.id]).map(person => `\n${person.name} (${person.code}): ${bucket.workers[person.id]}`).join("")} onClick={() => onSelectHour(day.key, hour)}>{roster.filter(person => bucket.workers[person.id]).map(person => <i key={person.id} data-worker-id={person.id} style={{ background: person.color, height: `${bucket.workers[person.id] / peak * 100}%` }}/>)}</button>;
      })}</div>
    </div>)}
    <div className="warehouse-week-scale">{hours[0]}:00–{hours[hours.length - 1]}:59 · escala común: {peak} pedidos/h · colores por operario</div>
  </div>;
}
