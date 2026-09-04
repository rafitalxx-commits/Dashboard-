import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  PackageOpen,
  RefreshCw,
  Search,
  Truck,
} from "lucide-react";
import { odooClient } from "../../services/odooClient";
import type {
  PurchaseReception,
  PurchaseReceptionsPayload,
} from "../../services/odooTypes";
import "./receptions.css";

type StatusFilter = "Todas" | PurchaseReception["status"];

export function ReceptionsView() {
  const [payload, setPayload] = useState<PurchaseReceptionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("Todas");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await odooClient.getPurchaseReceptions();
      setPayload(result);
      setExpanded((current) => current ?? result.receptions[0]?.id ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron leer las recepciones",
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
      if (status !== "Todas" && reception.status !== status) return false;
      if (!normalized) return true;
      return [
        reception.ref,
        reception.supplier,
        ...reception.lines.flatMap((line) => [line.name, line.sku, line.barcode]),
      ].some((value) => value.toLocaleLowerCase("es").includes(normalized));
    });
  }, [payload, query, status]);

  return (
    <section className="receptions-view">
      <header className="receptions-intro">
        <div>
          <span className="receptions-kicker">Productos · Solo lectura Odoo</span>
          <h2>Recepciones pendientes</h2>
          <p>Pedidos de compra confirmados con mercancía todavía por recibir.</p>
        </div>
        <button className="receptions-refresh" disabled={loading} onClick={() => void load()} type="button">
          <RefreshCw className={loading ? "spin" : ""} size={17} />
          {loading ? "Actualizando" : "Actualizar"}
        </button>
      </header>

      <div className="receptions-kpis">
        <ReceptionKpi label="Pedidos pendientes" value={payload?.total ?? 0} />
        <ReceptionKpi label="Líneas pendientes" value={payload?.pendingLines ?? 0} />
        <ReceptionKpi label="Unidades pendientes" value={formatQty(payload?.pendingUnits ?? 0)} />
      </div>

      <div className="receptions-toolbar">
        <label className="receptions-search">
          <Search size={18} />
          <input
            aria-label="Buscar recepciones"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar PO, proveedor, SKU o EAN"
            value={query}
          />
        </label>
        <div aria-label="Filtrar recepciones por estado" className="receptions-statuses">
          {(["Todas", "Pendiente", "Parcial", "Retrasado"] as StatusFilter[]).map((option) => (
            <button
              className={status === option ? "active" : ""}
              key={option}
              onClick={() => setStatus(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="receptions-message error">
          <AlertTriangle size={19} />
          <div><strong>No se pudo conectar con Recepciones</strong><span>{error}</span></div>
        </div>
      )}

      {loading && !payload && (
        <div className="receptions-message"><RefreshCw className="spin" size={19} /> Leyendo compras pendientes en Odoo…</div>
      )}

      {!loading && !error && receptions.length === 0 && (
        <div className="receptions-empty">
          <PackageOpen size={34} />
          <strong>No hay recepciones con estos filtros</strong>
          <span>Cambia la búsqueda o el estado seleccionado.</span>
        </div>
      )}

      <div className="receptions-list">
        {receptions.map((reception) => {
          const isExpanded = expanded === reception.id;
          return (
            <article className="reception-card" key={reception.id}>
              <button
                aria-expanded={isExpanded}
                className="reception-summary"
                onClick={() => setExpanded(isExpanded ? null : reception.id)}
                type="button"
              >
                <span className={`reception-status ${statusClass(reception.status)}`}>{reception.status}</span>
                <span className="reception-reference"><strong>{reception.ref}</strong><small>{reception.supplier}</small></span>
                <span className="reception-date"><CalendarClock size={16} /><span><small>Prevista</small>{formatDate(reception.expectedDate)}</span></span>
                <span className="reception-progress"><small>Pendiente</small><strong>{formatQty(reception.pendingQty)} uds.</strong><span>{reception.lines.length} líneas</span></span>
                {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>

              {isExpanded && (
                <div className="reception-detail">
                  <div className="reception-meta">
                    <span><small>Pedido</small><strong>{formatDate(reception.orderDate)}</strong></span>
                    <span><small>Estado Odoo</small><strong>{translateState(reception.state)}</strong></span>
                    <span><small>Total PO</small><strong>{formatMoney(reception.amountTotal, reception.currency)}</strong></span>
                    <span className="readonly-note"><Truck size={16} /> Consulta; no modifica Odoo</span>
                  </div>
                  <div className="reception-lines">
                    {reception.lines.map((line) => (
                      <div className="reception-line" key={line.id}>
                        <div className="reception-product-image">
                          {line.imageUrl ? <img alt="" src={line.imageUrl} /> : <PackageOpen size={22} />}
                        </div>
                        <div className="reception-product-copy">
                          <strong>{line.name}</strong>
                          <span>{line.sku || "Sin referencia"}{line.barcode ? ` · EAN ${line.barcode}` : ""}</span>
                          <small>Prevista {formatDate(line.expectedDate || reception.expectedDate)}</small>
                        </div>
                        <Quantity label="Pedida" value={line.orderedQty} />
                        <Quantity label="Recibida" value={line.receivedQty} />
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

function ReceptionKpi({ label, value }: { label: string; value: number | string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function Quantity({ emphasis, label, value }: { emphasis?: boolean; label: string; value: number }) {
  return <div className={`reception-quantity ${emphasis ? "emphasis" : ""}`}><small>{label}</small><strong>{formatQty(value)}</strong></div>;
}

function formatQty(value: number) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: currency || "EUR" }).format(value);
  } catch {
    return `${formatQty(value)} ${currency}`.trim();
  }
}

function statusClass(status: PurchaseReception["status"]) {
  return status === "Retrasado" ? "late" : status === "Parcial" ? "partial" : "pending";
}

function translateState(state: string) {
  return ({ purchase: "Confirmado", done: "Bloqueado" } as Record<string, string>)[state] ?? state;
}
