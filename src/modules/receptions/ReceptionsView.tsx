import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  PackageOpen,
  RefreshCw,
  Search,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  Truck,
} from "lucide-react";
import { odooClient } from "../../services/odooClient";
import type {
  PurchaseReception,
  PurchaseReceptionsPayload,
  PurchaseReceptionLine,
  PurchaseProductOption,
  PurchaseOrderActionPreview,
  PurchaseVendorOption,
} from "../../services/odooTypes";
import "./receptions.css";

type StatusFilter = "Todos" | PurchaseReception["status"];

export function PendingPurchasesView() {
  const [payload, setPayload] = useState<PurchaseReceptionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("Todos");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PurchaseReceptionLine[]>>({});
  const [productQuery, setProductQuery] = useState("");
  const [productQuantity, setProductQuantity] = useState(1);
  const [productResults, setProductResults] = useState<PurchaseProductOption[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [confirming, setConfirming] = useState<PurchaseReception | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionPreview, setActionPreview] = useState<PurchaseOrderActionPreview | null>(null);
  const [actionKind, setActionKind] = useState<"send" | "confirm" | null>(null);
  const [creating, setCreating] = useState(false);
  const [vendorQuery, setVendorQuery] = useState("");
  const [vendorResults, setVendorResults] = useState<PurchaseVendorOption[]>([]);
  const [vendorLoading, setVendorLoading] = useState(false);
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirming) return;
    acceptRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) setConfirming(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirming, saving]);

  const saveQuotation = async () => {
    if (!confirming || saving) return;
    const lines = drafts[confirming.id] ?? [];
    setSaving(true);
    setSaveError("");
    try {
      const originalIds = new Set(confirming.lines.map((line) => line.id));
      const currentIds = new Set(lines.map((line) => line.id));
      const result = await odooClient.savePendingPurchase(
        confirming.id,
        lines.map((line) => ({
          id: line.id,
          productId: line.productId || "",
          quantity: line.orderedQty,
          priceUnit: line.priceUnit,
          expectedDate: (line.expectedDate || confirming.expectedDate).slice(0, 10),
          description: line.description || line.name,
        })),
        [...originalIds].filter((id) => !currentIds.has(id)),
        confirming.partnerId,
      );
      setConfirming(null);
      setEditing(null);
      setMessage(`${result.ref || confirming.ref} guardado en Odoo. Los precios quedan registrados en su histórico de compra.`);
      await load();
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : "No se pudo guardar en Odoo");
    } finally {
      setSaving(false);
    }
  };

  const previewAction = async (reception: PurchaseReception, kind: "send" | "confirm") => {
    setActionLoading(`${reception.id}-${kind}`);
    setMessage("");
    try {
      setActionPreview(await odooClient.getPendingPurchaseActionPreview(reception.id));
      setActionKind(kind);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "No se pudo preparar la acción");
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    if (!creating || vendorQuery.trim().length < 2) { setVendorResults([]); return; }
    const timer = window.setTimeout(async () => {
      setVendorLoading(true);
      try { setVendorResults(await odooClient.getPurchaseVendors(vendorQuery)); }
      catch (failure) { setMessage(failure instanceof Error ? failure.message : "No se pudieron buscar proveedores"); }
      finally { setVendorLoading(false); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [creating, vendorQuery]);

  useEffect(() => {
    if (!editing || productQuery.trim().length < 2) { setProductResults([]); return; }
    const reception = payload?.receptions.find((item) => item.id === editing);
    if (!reception) return;
    const timer = window.setTimeout(async () => {
      setProductLoading(true);
      try { setProductResults(await odooClient.getPendingPurchaseProducts(reception.id, productQuery, productQuantity, reception.partnerId)); }
      catch (failure) { setMessage(failure instanceof Error ? failure.message : "No se pudieron buscar productos"); }
      finally { setProductLoading(false); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [editing, payload, productQuery, productQuantity]);

  const startNewQuotation = (vendor: PurchaseVendorOption) => {
    const id = `new-${Date.now()}`;
    const reception: PurchaseReception = { id, ref: "Nuevo presupuesto", supplier: vendor.name, partnerId: vendor.id, orderDate: new Date().toISOString().slice(0, 10), expectedDate: new Date().toISOString().slice(0, 10), state: "draft", status: "Borrador", amountTotal: 0, currency: vendor.currency || "EUR", lines: [], orderedQty: 0, receivedQty: 0, pendingQty: 0 };
    setPayload((current) => current ? { ...current, receptions: [reception, ...current.receptions], total: current.total + 1 } : { mode: "live", receptions: [reception], total: 1, pendingLines: 0, pendingUnits: 0 });
    setDrafts((current) => ({ ...current, [id]: [] }));
    setExpanded(id); setEditing(id); setCreating(false); setVendorQuery(""); setVendorResults([]);
    setMessage(`Nuevo presupuesto para ${vendor.name}. Añade al menos un producto.`);
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await odooClient.getPendingPurchases();
      setPayload(result);
      setExpanded((current) => current ?? result.receptions[0]?.id ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron leer las compras pendientes",
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
      if (status !== "Todos" && reception.status !== status) return false;
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
          <span className="receptions-kicker">Compras · Presupuestos Odoo</span>
          <h2>Compras pendientes</h2>
          <p>Presupuestos pendientes que todavía pueden editarse antes de confirmar.</p>
        </div>
        <div className="purchase-header-actions"><button onClick={() => setCreating(true)} type="button"><Plus size={17}/>Crear presupuesto</button><button className="receptions-refresh" disabled={loading} onClick={() => void load()} type="button">
          <RefreshCw className={loading ? "spin" : ""} size={17} />
          {loading ? "Actualizando" : "Actualizar"}
        </button></div>
      </header>

      <div className="receptions-kpis">
        <ReceptionKpi label="Presupuestos pendientes" value={payload?.total ?? 0} />
        <ReceptionKpi label="Líneas" value={payload?.pendingLines ?? 0} />
        <ReceptionKpi label="Unidades solicitadas" value={formatQty(payload?.pendingUnits ?? 0)} />
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
          {(["Todos", "Borrador", "Enviado"] as StatusFilter[]).map((option) => (
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
          <div><strong>No se pudieron leer las compras pendientes</strong><span>{error}</span></div>
        </div>
      )}
      {message && <div className="receptions-message" role="status"><Save size={19}/>{message}</div>}

      {loading && !payload && (
        <div className="receptions-message"><RefreshCw className="spin" size={19} /> Leyendo pedidos de compra en Odoo…</div>
      )}

      {!loading && !error && receptions.length === 0 && (
        <div className="receptions-empty">
          <PackageOpen size={34} />
          <strong>No hay presupuestos con estos filtros</strong>
          <span>Cambia la búsqueda o el estado seleccionado.</span>
        </div>
      )}

      <div className="receptions-list">
        {receptions.map((reception) => {
          const isExpanded = expanded === reception.id;
          const isEditing = editing === reception.id;
          const visibleLines = drafts[reception.id] ?? reception.lines;
          const draftTotal = visibleLines.reduce((total, line) => total + line.orderedQty * line.priceUnit, 0);
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
                <span className="reception-progress"><small>Pendiente</small><strong>{formatQty(reception.pendingQty)} uds.</strong><span>{reception.lines.length} líneas</span></span>
                {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>

              {isExpanded && (
                <div className="reception-detail">
                  <div className="reception-meta">
                    <span><small>Pedido</small><strong>{formatDate(reception.orderDate)}</strong></span>
                    <span><small>Estado Odoo</small><strong>{translateState(reception.state)}</strong></span>
                    <span><small>Total líneas</small><strong>{formatMoney(isEditing ? draftTotal : reception.amountTotal, reception.currency)}</strong></span>
                    {!isEditing ? <div className="purchase-order-actions"><button disabled={Boolean(actionLoading)} onClick={() => void previewAction(reception, "confirm")} type="button">{actionLoading === `${reception.id}-confirm` ? <><RefreshCw className="spin" size={15}/>Comprobando…</> : <><CheckCircle2 size={15}/>Confirmar pedido</>}</button><button className="reception-edit" onClick={() => { setEditing(reception.id); setDrafts((current) => ({ ...current, [reception.id]: reception.lines.map((line) => ({ ...line })) })); setMessage("Edición local iniciada. Odoo todavía no se ha modificado."); }} type="button">Editar presupuesto</button></div> : <span className="readonly-note"><Truck size={16}/>Cambios locales · sin enviar</span>}
                  </div>
                  <div className="reception-lines">
                    {visibleLines.map((line) => (
                      <div className="reception-line" key={line.id}>
                        <div className="reception-product-image">
                          {line.imageUrl ? <img alt="" src={line.imageUrl} /> : <PackageOpen size={22} />}
                        </div>
                        <div className="reception-product-copy">
                          <strong>{line.name}</strong>
                          <span>{line.sku || "Sin referencia"}{line.barcode ? ` · EAN ${line.barcode}` : ""}</span>
                          {isEditing ? <label className="reception-line-description">Descripción<textarea onChange={(event) => setDrafts((current) => ({ ...current, [reception.id]: visibleLines.map((item) => item.id === line.id ? { ...item, description: event.target.value } : item) }))} rows={2} value={line.description || line.name}/></label> : line.description && line.description !== line.name ? <small>{line.description}</small> : null}
                        </div>
                        {isEditing ? <><label className="reception-edit-field">Cantidad<input min="0.01" onChange={(event) => setDrafts((current) => ({ ...current, [reception.id]: visibleLines.map((item) => item.id === line.id ? { ...item, orderedQty: Math.max(0, Number(event.target.value)), pendingQty: Math.max(0, Number(event.target.value)), subtotal: Math.max(0, Number(event.target.value)) * item.priceUnit } : item) }))} step="0.01" type="number" value={line.orderedQty}/></label><label className="reception-edit-field">Precio compra<input min="0" onChange={(event) => setDrafts((current) => ({ ...current, [reception.id]: visibleLines.map((item) => item.id === line.id ? { ...item, priceUnit: Math.max(0, Number(event.target.value)), subtotal: item.orderedQty * Math.max(0, Number(event.target.value)) } : item) }))} step="0.0001" type="number" value={line.priceUnit}/></label><button aria-label={`Eliminar ${line.name}`} className="reception-remove-line" onClick={() => setDrafts((current) => ({ ...current, [reception.id]: visibleLines.filter((item) => item.id !== line.id) }))} type="button"><Trash2 size={17}/></button></> : <><Quantity label="Cantidad" value={line.orderedQty}/><Quantity label="Precio" value={line.priceUnit}/><Quantity emphasis label="Subtotal" value={line.subtotal}/></>}
                        {line.costMethod === "standard" && <small className="reception-cost-warning">Coste estándar: la compra queda en histórico, pero no cambia el coste automáticamente.</small>}
                      </div>
                    ))}
                  </div>
                  {isEditing && <div className="reception-editor-footer"><div className="reception-product-search"><label><Search size={16}/><input onChange={(event) => setProductQuery(event.target.value)} placeholder="Referencia, nombre o EAN · usa a+b para combinar" value={productQuery}/>{productLoading && <RefreshCw className="spin" size={16}/>}</label><label className="product-search-quantity">Cantidad<input min="0.01" onChange={(event) => setProductQuantity(Math.max(.01, Number(event.target.value)))} step="0.01" type="number" value={productQuantity}/></label></div>{productResults.length > 0 && <div className="reception-product-results">{productResults.map((product) => <button key={product.id} onClick={() => { const line: PurchaseReceptionLine = { id: `new-${product.id}-${Date.now()}`, productId: product.id, name: product.name, description: product.name, sku: product.sku, barcode: product.barcode, imageUrl: product.imageUrl, orderedQty: productQuantity, receivedQty: 0, pendingQty: productQuantity, priceUnit: product.suggestedPrice, subtotal: productQuantity * product.suggestedPrice, uom: product.uom, expectedDate: reception.expectedDate, costMethod: product.costMethod }; setDrafts((current) => ({ ...current, [reception.id]: [...visibleLines, line] })); setProductResults([]); setProductQuery(""); setProductQuantity(1); setMessage(product.supplierPriceFound ? `Producto añadido con tarifa de ${reception.supplier}: ${formatMoney(product.suggestedPrice, product.supplierCurrency || reception.currency)}.` : `Producto añadido sin tarifa válida de ${reception.supplier}; introduce el precio manualmente.`); }} type="button"><Plus size={16}/><span><strong>{product.sku || "Sin referencia"} · {product.name}</strong><small>{product.supplierPriceFound ? `Tarifa proveedor ${formatMoney(product.suggestedPrice, product.supplierCurrency || reception.currency)}${product.supplierMinQty ? ` desde ${product.supplierMinQty} uds.` : ""}` : "Sin precio válido del proveedor"}</small></span></button>)}</div>}<div className="reception-editor-actions"><button onClick={() => { setEditing(null); setProductResults([]); setMessage("Cambios descartados. Odoo no se ha modificado."); }} type="button">Cancelar cambios</button><button className="primary" disabled={visibleLines.length === 0 || visibleLines.some((line) => line.orderedQty <= 0 || line.priceUnit <= 0)} onClick={() => { setSaveError(""); setConfirming(reception); }} type="button"><Save size={16}/>Revisar cambios</button></div></div>}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {creating && <div aria-labelledby="new-purchase-title" aria-modal="true" className="purchase-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }} role="dialog"><div className="purchase-modal"><h3 id="new-purchase-title">Crear presupuesto de compra</h3><p>Busca y selecciona el proveedor. El presupuesto se mantendrá en borrador hasta que lo confirmes.</p><label className="purchase-vendor-search"><Search size={17}/><input autoFocus onChange={(event) => setVendorQuery(event.target.value)} placeholder="Proveedor · usa a+b para combinar términos" value={vendorQuery}/>{vendorLoading && <RefreshCw className="spin" size={16}/>}</label>{vendorResults.length > 0 && <div className="reception-product-results">{vendorResults.map((vendor) => <button key={vendor.id} onClick={() => startNewQuotation(vendor)} type="button"><Plus size={16}/><span><strong>{vendor.name}</strong><small>{vendor.email || "Sin email configurado"}</small></span></button>)}</div>}<div className="purchase-modal-actions"><button onClick={() => setCreating(false)} type="button">Cancelar</button></div></div></div>}
      {confirming && (() => {
        const lines = drafts[confirming.id] ?? [];
        const total = lines.reduce((sum, line) => sum + line.orderedQty * line.priceUnit, 0);
        return <div aria-labelledby="purchase-confirm-title" aria-modal="true" className="purchase-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setConfirming(null); }} role="dialog">
          <div className="purchase-modal">
            <h3 id="purchase-confirm-title">Guardar presupuesto en Odoo</h3>
            <p>Se actualizará <strong>{confirming.ref}</strong>. Los precios quedarán guardados en el histórico real de compras.</p>
            <dl><div><dt>Proveedor</dt><dd>{confirming.supplier}</dd></div><div><dt>Líneas</dt><dd>{lines.length}</dd></div><div><dt>Total</dt><dd>{formatMoney(total, confirming.currency)}</dd></div></dl>
            {lines.some((line) => line.costMethod === "standard") && <div className="purchase-modal-warning"><AlertTriangle size={18}/>Hay productos de coste estándar: el precio quedará en el histórico, pero la recepción no actualizará automáticamente su coste.</div>}
            {saveError && <div className="purchase-modal-error" role="alert">{saveError}</div>}
            <div className="purchase-modal-actions"><button disabled={saving} onClick={() => setConfirming(null)} type="button">Cancelar</button><button className="primary" disabled={saving} onClick={() => void saveQuotation()} ref={acceptRef} type="button">{saving ? <><RefreshCw className="spin" size={16}/>Guardando en Odoo…</> : <><Save size={16}/>Guardar en Odoo</>}</button></div>
          </div>
        </div>;
      })()}
      {actionPreview && actionKind && <div aria-labelledby="purchase-action-title" aria-modal="true" className="purchase-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setActionPreview(null); setActionKind(null); } }} role="dialog"><div className="purchase-modal"><h3 id="purchase-action-title">Confirmar pedido de compra</h3><p><strong>{actionPreview.ref}</strong> · {actionPreview.supplier}</p><dl><div><dt>Líneas</dt><dd>{actionPreview.lineCount}</dd></div><div><dt>Total</dt><dd>{formatMoney(actionPreview.total, actionPreview.currency)}</dd></div><div><dt>Albarán nativo</dt><dd>{actionPreview.willCreateReceipt ? `Sí · ${actionPreview.receiptProductLines} líneas de producto` : "No · solo servicios"}</dd></div><div><dt>Email proveedor</dt><dd>{actionPreview.supplierEmail || "Sin email configurado"}</dd></div></dl><div className="purchase-modal-warning"><AlertTriangle size={18}/>Simulación LAB: no se confirmará el pedido ni se enviará ningún correo real.</div><div className="purchase-modal-actions"><button onClick={() => { setActionPreview(null); setActionKind(null); }} type="button">Cancelar</button><button className="primary" onClick={() => { setMessage("Simulación completada: Odoo confirmaría el pedido y generaría el albarán nativo, sin enviar email."); setActionPreview(null); setActionKind(null); }} type="button">Aceptar</button><button className="primary" disabled={!actionPreview.supplierEmail} onClick={() => { setMessage("Simulación completada: Odoo confirmaría el pedido, generaría el albarán y enviaría el email al proveedor."); setActionPreview(null); setActionKind(null); }} type="button">Aceptar y enviar email</button></div></div></div>}
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
  return status === "Enviado" ? "partial" : "pending";
}

function translateState(state: string) {
  return ({ draft: "Presupuesto", sent: "Presupuesto enviado" } as Record<string, string>)[state] ?? state;
}
