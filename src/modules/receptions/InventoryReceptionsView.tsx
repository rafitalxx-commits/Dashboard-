import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  MapPin,
  PackageCheck,
  RefreshCw,
  Search,
  Warehouse,
} from "lucide-react";
import { odooClient } from "../../services/odooClient";
import type {
  InventoryReception,
  InventoryReceptionsPayload,
} from "../../services/odooTypes";
import "./inventory-receptions.css";

type ReceptionFilter = "Todas" | InventoryReception["status"];

export function InventoryReceptionsView() {
  const [payload, setPayload] = useState<InventoryReceptionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReceptionFilter>("Todas");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await odooClient.getInventoryReceptions();
      setPayload(result);
      setExpanded((current) => current ?? result.receptions[0]?.id ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron leer las recepciones de Inventario",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const receptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return (payload?.receptions ?? []).filter((reception) => {
      if (filter !== "Todas" && reception.status !== filter) return false;
      if (!normalized) return true;
      return [
        reception.ref,
        reception.purchaseRef,
        reception.supplier,
        ...reception.lines.flatMap((line) => [line.name, line.sku, line.barcode]),
      ].some((value) => value.toLocaleLowerCase("es").includes(normalized));
    });
  }, [filter, payload, query]);

  return (
    <section className="inventory-receptions">
      <header className="inventory-receptions-hero">
        <div>
          <span>Inventario Odoo · Solo lectura</span>
          <h2>Recepciones de almacén</h2>
          <p>Operaciones de entrada pendientes de procesar en Inventario.</p>
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
          <input
            aria-label="Buscar recepciones de Inventario"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar recepción, PO, proveedor, SKU o EAN"
            value={query}
          />
        </label>
        <div aria-label="Filtrar recepciones de Inventario por estado">
          {(["Todas", "Preparada", "Esperando"] as ReceptionFilter[]).map((option) => (
            <button
              className={filter === option ? "active" : ""}
              key={option}
              onClick={() => setFilter(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="inventory-receptions-notice error">
          <AlertTriangle size={19} />
          <div><strong>No se pudieron leer las recepciones</strong><span>{error}</span></div>
        </div>
      )}
      {loading && !payload && (
        <div className="inventory-receptions-notice">
          <RefreshCw className="inventory-spin" size={19} />
          Leyendo operaciones de entrada en Odoo…
        </div>
      )}
      {!loading && !error && receptions.length === 0 && (
        <div className="inventory-receptions-empty">
          <Warehouse size={36} />
          <strong>No hay recepciones con estos filtros</strong>
          <span>Cambia la búsqueda o el estado seleccionado.</span>
        </div>
      )}

      <div className="inventory-receptions-list">
        {receptions.map((reception) => {
          const isExpanded = expanded === reception.id;
          return (
            <article className="inventory-reception-card" key={reception.id}>
              <button
                aria-expanded={isExpanded}
                className="inventory-reception-summary"
                onClick={() => setExpanded(isExpanded ? null : reception.id)}
                type="button"
              >
                <span className={`inventory-state ${stateClass(reception.status)}`}>{reception.status}</span>
                <span className="inventory-reference">
                  <strong>{reception.ref}</strong>
                  <small>{reception.purchaseRef || "Sin PO relacionado"}</small>
                </span>
                <span className="inventory-supplier"><small>Proveedor</small><strong>{reception.supplier}</strong></span>
                <span className="inventory-date"><CalendarClock size={16} /><span><small>Programada</small>{formatDate(reception.scheduledDate)}</span></span>
                <span className="inventory-progress"><small>Pendiente</small><strong>{formatQty(reception.pendingQty)} uds.</strong><span>{reception.lines.length} líneas</span></span>
                {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>

              {isExpanded && (
                <div className="inventory-reception-detail">
                  <div className="inventory-reception-meta">
                    <span><MapPin size={16} /><small>Destino</small><strong>{reception.destination || "Sin ubicación destino"}</strong></span>
                    <span><PackageCheck size={16} /><small>Estado Odoo</small><strong>{translateState(reception.state)}</strong></span>
                    <em>Consulta; no valida ni modifica Odoo</em>
                  </div>
                  <div className="inventory-reception-lines">
                    {reception.lines.map((line) => (
                      <div className="inventory-reception-line" key={line.id}>
                        <div className="inventory-product-image">
                          {line.imageUrl ? <img alt="" src={line.imageUrl} /> : <PackageCheck size={22} />}
                        </div>
                        <div className="inventory-product-copy">
                          <strong>{line.name}</strong>
                          <span>{line.sku || "Sin referencia"}{line.barcode ? ` · EAN ${line.barcode}` : ""}</span>
                        </div>
                        <Quantity label="Esperada" value={line.expectedQty} />
                        <Quantity label="Procesada" value={line.processedQty} />
                        <Quantity emphasis label="Pendiente" value={line.pendingQty} />
                      </div>
                    ))}
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

function Kpi({ label, tone = "", value }: { label: string; tone?: string; value: number }) {
  return <div className={tone}><span>{label}</span><strong>{value}</strong></div>;
}

function Quantity({ emphasis, label, value }: { emphasis?: boolean; label: string; value: number }) {
  return <div className={`inventory-quantity ${emphasis ? "emphasis" : ""}`}><small>{label}</small><strong>{formatQty(value)}</strong></div>;
}

function stateClass(status: InventoryReception["status"]) {
  return status === "Preparada" ? "ready" : status === "Esperando" ? "waiting" : status === "Borrador" ? "draft" : "other";
}

function translateState(state: string) {
  return ({ assigned: "Preparada", confirmed: "Esperando disponibilidad", waiting: "Esperando otra operación", draft: "Borrador" } as Record<string, string>)[state] ?? state;
}

function formatQty(value: number) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
