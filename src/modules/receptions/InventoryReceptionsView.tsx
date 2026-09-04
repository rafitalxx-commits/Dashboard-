import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronUp, MapPin,
  PackageCheck, Play, Plus, RefreshCw, Search, Trash2, UserRound, Warehouse,
} from "lucide-react";
import { odooClient } from "../../services/odooClient";
import type {
  InventoryReception, InventoryReceptionLine, InventoryReceptionsPayload,
  ReceptionLocationPlan, ReceptionSession,
} from "../../services/odooTypes";
import {
  allocatedQuantity, createLocationPlan, isLocationPlanBalanced, normalizedQuantity,
} from "./locationPlan";
import "./inventory-receptions.css";

type ReceptionFilter = "Todas" | InventoryReception["status"];
type WarehouseWorker = { id: string; code: string; name: string; active: boolean };
const plansStorageKey = "dashboard.reception-location-plans.v1";
const receptionApiPath = (path: string) =>
  window.location.pathname.startsWith("/inventory-lab/")
    ? `/inventory-lab${path}`
    : path;

export function InventoryReceptionsView() {
  const [payload, setPayload] = useState<InventoryReceptionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReceptionFilter>("Todas");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [plans, setPlans] = useState<Record<string, ReceptionLocationPlan>>(() => {
    try {
      return JSON.parse(localStorage.getItem(plansStorageKey) || "{}") as Record<string, ReceptionLocationPlan>;
    } catch {
      return {};
    }
  });
  const [sessions, setSessions] = useState<ReceptionSession[]>([]);
  const [startingReception, setStartingReception] = useState<string | null>(null);
  const [operatorCode, setOperatorCode] = useState("");
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [result, savedSessions] = await Promise.all([
        odooClient.getInventoryReceptions(),
        odooClient.getReceptionSessions().catch(() => []),
      ]);
      setPayload(result);
      setSessions(savedSessions);
      setExpanded((current) => current ?? result.receptions[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron leer las recepciones de Inventario");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    localStorage.setItem(plansStorageKey, JSON.stringify(plans));
  }, [plans]);

  const receptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return (payload?.receptions ?? []).filter((reception) => {
      if (filter !== "Todas" && reception.status !== filter) return false;
      if (!normalized) return true;
      return [
        reception.ref, reception.purchaseRef, reception.supplier,
        ...reception.lines.flatMap((line) => [
          line.name, line.sku, line.barcode, line.preferredLocation ?? "", ...line.saleOrderRefs,
        ]),
      ].some((value) => value.toLocaleLowerCase("es").includes(normalized));
    });
  }, [filter, payload, query]);

  const sessionsByReceptionId = useMemo(
    () => new Map(sessions.filter((session) => session.status === "in_progress").map((session) => [session.receptionId, session])),
    [sessions],
  );

  const togglePlan = (line: InventoryReceptionLine) => {
    setPlans((current) => current[line.id] ? current : { ...current, [line.id]: createLocationPlan(line) });
    setOpenPlan((current) => current === line.id ? null : line.id);
  };

  const updatePlan = (lineId: string, plan: ReceptionLocationPlan) => {
    setPlans((current) => ({ ...current, [lineId]: { ...plan, ready: false } }));
  };

  const beginReception = async (reception: InventoryReception) => {
    const normalizedCode = operatorCode.trim().toUpperCase();
    if (!normalizedCode) {
      setError("Escanea el QR del operario antes de iniciar la recepción");
      return;
    }
    setStarting(true);
    setError("");
    setMessage("");
    try {
      const workerResponse = await fetch(receptionApiPath(`/api/warehouse-workers/resolve/${encodeURIComponent(normalizedCode)}`));
      const workerPayload = await workerResponse.json() as { worker?: WarehouseWorker; message?: string };
      if (!workerResponse.ok || !workerPayload.worker) {
        throw new Error(workerPayload.message || "QR de operario no válido o inactivo");
      }
      const session = await odooClient.startReceptionSession({
        receptionId: reception.id,
        receptionRef: reception.ref,
        purchaseRef: reception.purchaseRef,
        operator: workerPayload.worker,
      });
      setSessions((current) => [session, ...current.filter((item) => item.receptionId !== session.receptionId)]);
      setStartingReception(null);
      setOperatorCode("");
      setMessage(`Recepción iniciada por ${session.operator.name}`);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "No se pudo iniciar la recepción");
    } finally {
      setStarting(false);
    }
  };

  const completeReception = async (receptionId: string) => {
    setCompleting(receptionId);
    setError("");
    setMessage("");
    try {
      const session = await odooClient.completeReceptionSession(receptionId);
      setSessions((current) => current.map((item) => item.receptionId === receptionId ? session : item));
      setMessage(`Sesión de ${session.receptionRef} finalizada correctamente`);
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "No se pudo finalizar la recepción");
    } finally {
      setCompleting(null);
    }
  };

  return (
    <section className="inventory-receptions">
      <header className="inventory-receptions-hero">
        <div>
          <span>Inventario Odoo · Solo lectura</span>
          <h2>Recepciones de almacén</h2>
          <p>Clasificación real por pedido de venta y propuesta de ubicación.</p>
        </div>
        <button disabled={loading} onClick={() => void load()} type="button">
          <RefreshCw className={loading ? "inventory-spin" : ""} size={17} />
          {loading ? "Actualizando" : "Actualizar"}
        </button>
      </header>

      <div className="inventory-receptions-kpis">
        <Kpi label="Recepciones abiertas" value={payload?.total ?? 0} />
        <Kpi label="Preparadas" value={payload?.ready ?? 0} tone="ready" />
        <Kpi label="Esperando" value={payload?.waiting ?? 0} tone="waiting" />
        <Kpi label="Líneas pendientes" value={payload?.pendingLines ?? 0} />
      </div>

      <div className="inventory-receptions-toolbar">
        <label>
          <Search size={18} />
          <input aria-label="Buscar recepciones de Inventario" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar recepción, PO, proveedor, SO, SKU o EAN" value={query} />
        </label>
        <div aria-label="Filtrar recepciones de Inventario por estado">
          {(["Todas", "Preparada", "Esperando"] as ReceptionFilter[]).map((option) => (
            <button className={filter === option ? "active" : ""} key={option} onClick={() => setFilter(option)} type="button">{option}</button>
          ))}
        </div>
      </div>

      {error && <div className="inventory-receptions-notice error"><AlertTriangle size={19} /><div><strong>No se pudieron leer las recepciones</strong><span>{error}</span></div></div>}
      {message && <div aria-live="polite" className="inventory-receptions-notice success"><CheckCircle2 size={19} /><span>{message}</span></div>}
      {loading && !payload && <div className="inventory-receptions-notice"><RefreshCw className="inventory-spin" size={19} />Leyendo operaciones de entrada en Odoo…</div>}
      {!loading && !error && receptions.length === 0 && <div className="inventory-receptions-empty"><Warehouse size={36} /><strong>No hay recepciones con estos filtros</strong><span>Cambia la búsqueda o el estado seleccionado.</span></div>}

      <div className="inventory-receptions-list">
        {receptions.map((reception) => {
          const isExpanded = expanded === reception.id;
          const session = sessionsByReceptionId.get(reception.id);
          return (
            <article className="inventory-reception-card" key={reception.id}>
              <button aria-expanded={isExpanded} className="inventory-reception-summary" onClick={() => setExpanded(isExpanded ? null : reception.id)} type="button">
                <span className={`inventory-state ${session ? "in-progress" : stateClass(reception.status)}`}>{session ? "En curso" : reception.status}</span>
                <span className="inventory-reference"><strong>{reception.ref}</strong><small>{reception.purchaseRef || "Sin PO relacionado"}</small></span>
                <span className="inventory-supplier"><small>Proveedor</small><strong>{reception.supplier}</strong></span>
                <span className="inventory-date"><CalendarClock size={16} /><span><small>Programada</small>{formatDate(reception.scheduledDate)}</span></span>
                <span className="inventory-progress"><small>Pendiente</small><strong>{formatQty(reception.pendingQty)} uds.</strong><span>{reception.lines.length} líneas</span></span>
                {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>

              {isExpanded && (
                <div className="inventory-reception-detail">
                  <div className="inventory-reception-meta">
                    <span><MapPin size={16} /><small>Destino Odoo</small><strong>{reception.destination || "Sin ubicación destino"}</strong></span>
                    <span><PackageCheck size={16} /><small>Estado Odoo</small><strong>{translateState(reception.state)}</strong></span>
                    {session ? (
                      <><span className="inventory-active-session"><UserRound size={16} /><small>Recepción en curso</small><strong>{session.operator.name} · {formatTime(session.startedAt)}</strong></span><button disabled={completing === reception.id} onClick={() => void completeReception(reception.id)} type="button"><CheckCircle2 size={16} /> {completing === reception.id ? "Finalizando…" : "Finalizar sesión"}</button></>
                    ) : (
                      <button className="inventory-start-button" onClick={() => { setStartingReception(reception.id); setOperatorCode(""); }} type="button"><Play size={16} /> Iniciar recepción</button>
                    )}
                    <em>Sesión local; no modifica Odoo</em>
                  </div>
                  {startingReception === reception.id && !session && (
                    <div className="inventory-start-panel">
                      <div><strong>Identificar al operario</strong><span>Escanea su QR OP; quedará asociado a toda la recepción.</span></div>
                      <label>Código QR del operario<input autoFocus onChange={(event) => setOperatorCode(event.target.value)} placeholder="OP001" value={operatorCode} /></label>
                      <button disabled={starting || !operatorCode.trim()} onClick={() => void beginReception(reception)} type="button"><Play size={16} /> {starting ? "Validando operario…" : "Empezar recepción"}</button>
                      <button className="inventory-start-cancel" disabled={starting} onClick={() => { setStartingReception(null); setOperatorCode(""); }} type="button">Cancelar</button>
                    </div>
                  )}
                  <div className="inventory-reception-lines">
                    {reception.lines.map((line) => {
                      const plan = plans[line.id];
                      return (
                        <article className="inventory-reception-line" key={line.id}>
                          <div className="inventory-reception-line-main">
                            <div className="inventory-product-image">{line.imageUrl ? <img alt="" src={line.imageUrl} /> : <PackageCheck size={22} />}</div>
                            <div className="inventory-product-copy">
                              <strong>{line.name}</strong>
                              <span>{line.sku || "Sin referencia"}{line.barcode ? ` · EAN ${line.barcode}` : ""}</span>
                              <LineClassification line={line} />
                            </div>
                            <Quantity label="Esperada" value={line.expectedQty} />
                            <Quantity label="Procesada" value={line.processedQty} />
                            <Quantity emphasis label="Pendiente" value={line.pendingQty} />
                            <button aria-expanded={openPlan === line.id} className="inventory-plan-toggle" onClick={() => togglePlan(line)} type="button">
                              <MapPin size={16} />{openPlan === line.id ? "Cerrar reparto" : "Repartir ubicación"}
                            </button>
                          </div>
                          {openPlan === line.id && plan && <LocationPlanEditor line={line} onChange={(nextPlan) => updatePlan(line.id, nextPlan)} onReady={() => setPlans((current) => ({ ...current, [line.id]: { ...current[line.id], ready: true } }))} plan={plan} />}
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LineClassification({ line }: { line: InventoryReceptionLine }) {
  if (line.classification === "under_order") {
    return <div className="inventory-line-classification under-order"><b>🔴 BAJO PEDIDO</b><span>Necesario para {line.saleOrderRefs.join(", ")}</span></div>;
  }
  return <div className="inventory-line-classification replenishment"><b>🟠 REPOSICIÓN</b><span>📍 Ubicación preferente: {line.preferredLocation || "Sin definir"}</span></div>;
}

function LocationPlanEditor({ line, onChange, onReady, plan }: { line: InventoryReceptionLine; onChange: (plan: ReceptionLocationPlan) => void; onReady: () => void; plan: ReceptionLocationPlan }) {
  const total = allocatedQuantity(plan.allocations);
  const balanced = isLocationPlanBalanced(plan);
  const difference = plan.receivedQty - total;
  const updateAllocation = (id: string, field: "location" | "quantity", value: string) => {
    onChange({ ...plan, allocations: plan.allocations.map((allocation) => allocation.id === id ? { ...allocation, [field]: field === "quantity" ? normalizedQuantity(value) : value } : allocation) });
  };

  return (
    <div className="inventory-location-plan">
      <header>
        <div><strong>Distribución física propuesta</strong><span>Las ubicaciones reales pueden ser distintas de la preferente.</span></div>
        <label>Cantidad a recibir<input min="0" onChange={(event) => onChange({ ...plan, receivedQty: normalizedQuantity(event.target.value) })} step="any" type="number" value={plan.receivedQty} /></label>
      </header>
      {line.preferredLocation && <button className="inventory-use-preferred" onClick={() => onChange({ ...plan, allocations: [{ id: `${line.id}-preferred`, location: line.preferredLocation!, quantity: plan.receivedQty }] })} type="button"><MapPin size={15} /> Usar {line.preferredLocation} para toda la cantidad</button>}
      <div className="inventory-allocation-list">
        {plan.allocations.map((allocation, index) => (
          <div className="inventory-allocation-row" key={allocation.id}>
            <span>{index + 1}</span>
            <label>Ubicación real<input onChange={(event) => updateAllocation(allocation.id, "location", event.target.value)} placeholder="Ej. A-03 o PALLET-05" value={allocation.location} /></label>
            <label>Cantidad<input min="0" onChange={(event) => updateAllocation(allocation.id, "quantity", event.target.value)} step="any" type="number" value={allocation.quantity} /></label>
            <button aria-label={`Eliminar ubicación ${index + 1}`} className="inventory-delete-allocation" onClick={() => onChange({ ...plan, allocations: plan.allocations.filter((item) => item.id !== allocation.id) })} type="button"><Trash2 size={17} /></button>
          </div>
        ))}
      </div>
      <button className="inventory-add-allocation" onClick={() => onChange({ ...plan, allocations: [...plan.allocations, { id: `${line.id}-${Date.now()}`, location: "", quantity: 0 }] })} type="button"><Plus size={16} /> Añadir ubicación</button>
      <footer className={balanced ? "balanced" : "unbalanced"}>
        <div><strong>{formatQty(total)} de {formatQty(plan.receivedQty)} uds. repartidas</strong><span>{balanced ? "La suma coincide." : `${difference > 0 ? "Faltan" : "Sobran"} ${formatQty(Math.abs(difference))} uds.`}</span></div>
        <button disabled={!balanced} onClick={onReady} type="button"><CheckCircle2 size={17} /> {plan.ready ? "Reparto listo" : "Marcar reparto listo"}</button>
      </footer>
      {plan.ready && <p className="inventory-plan-saved">Propuesta guardada en este dispositivo. No se ha enviado ni validado en Odoo.</p>}
    </div>
  );
}

function Kpi({ label, tone = "", value }: { label: string; tone?: string; value: number }) { return <div className={tone}><span>{label}</span><strong>{value}</strong></div>; }
function Quantity({ emphasis, label, value }: { emphasis?: boolean; label: string; value: number }) { return <div className={`inventory-quantity ${emphasis ? "emphasis" : ""}`}><small>{label}</small><strong>{formatQty(value)}</strong></div>; }
function stateClass(status: InventoryReception["status"]) { return status === "Preparada" ? "ready" : status === "Esperando" ? "waiting" : status === "Borrador" ? "draft" : "other"; }
function translateState(state: string) { return ({ assigned: "Preparada", confirmed: "Esperando disponibilidad", waiting: "Esperando otra operación", draft: "Borrador" } as Record<string, string>)[state] ?? state; }
function formatQty(value: number) { return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value); }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Hora sin registrar" : new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date); }
function formatDate(value: string) { if (!value) return "Sin fecha"; const date = new Date(`${value.slice(0, 10)}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date); }
