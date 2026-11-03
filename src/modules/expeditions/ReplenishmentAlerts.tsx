import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, CircleAlert, Package, RefreshCw } from "lucide-react";
import { replenishmentClient, type ReplenishmentItem } from "./replenishmentClient";
import "./replenishment.css";

type Draft = { productId: number; fromCode: string; quantity: string; requestId: string };
const pageSize = 8;
const qty = (value: number) => value.toLocaleString("es-ES", { maximumFractionDigits: 4 });

export function ReplenishmentAlerts() {
  const [items, setItems] = useState<ReplenishmentItem[]>([]);
  const [previewCapturedAt, setPreviewCapturedAt] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [images, setImages] = useState<Record<string, string>>({});
  const [imageError, setImageError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const requestVersion = useRef(0);
  const readInFlight = useRef(false);
  const writeInFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const sourceControl = useRef<HTMLSelectElement | null>(null);

  const refresh = useCallback(async () => {
    if (readInFlight.current || writeInFlight.current) return;
    readInFlight.current = true;
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const payload = await replenishmentClient.list();
      if (version !== requestVersion.current) return;
      setItems(payload.items); setPreviewCapturedAt(payload.previewCapturedAt || ""); setLoaded(true); setError("");
    } catch (cause) {
      if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : "No se pudieron leer los avisos");
    } finally { readInFlight.current = false; setLoading(false); }
  }, []);

  useEffect(() => {
    if (draft) return;
    void refresh();
    const update = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(update, 30000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [draft, refresh]);
  useEffect(() => { if (draft) sourceControl.current?.focus(); }, [draft?.productId]);

  const filtered = items.filter((item) => `${item.reference} ${item.name} ${item.preferred.code} ${item.sources.map((source) => source.code).join(" ")}`.toLocaleLowerCase("es").includes(query.trim().toLocaleLowerCase("es")));
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const imageIds = visible.map((item) => item.productId).join(",");
  useEffect(() => {
    const ids = imageIds.split(",").filter(Boolean).map(Number);
    if (!ids.length) return;
    let cancelled = false;
    setImageError("");
    void replenishmentClient.images(ids).then((next) => {
      if (!cancelled) setImages((previous) => ({ ...previous, ...next }));
    }).catch(() => { if (!cancelled) setImageError("No se pudieron cargar las fotos del catálogo."); });
    return () => { cancelled = true; };
  }, [imageIds]);

  const close = () => { setDraft(null); setSaveError(""); trigger.current?.focus(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (writeInFlight.current || !draft) return;
    const item = items.find((item) => item.productId === draft.productId);
    const source = item?.sources.find((source) => source.code === draft.fromCode);
    const quantity = Number(draft.quantity.replace(",", "."));
    if (!item || !source?.active || !item.preferred.active || !Number.isFinite(quantity) || quantity <= 0 || quantity > source.quantity) {
      setSaveError("Indica una cantidad mayor que cero y no superior al stock del origen."); return;
    }
    writeInFlight.current = true; ++requestVersion.current;
    setSaving(true); setSaveError(""); setResult("");
    try {
      const payload = await replenishmentClient.transfer({ productId: item.productId, fromCode: source.code, toCode: item.preferred.code, quantity, requestId: draft.requestId });
      setItems(payload.items);
      setResult(`Reposición registrada: ${item.reference} · ${qty(quantity)} ${item.uom} de ${source.code} a ${item.preferred.code}.`);
      close();
    } catch (cause) {
      setSaveError(`${cause instanceof Error ? cause.message : "No se pudo confirmar el movimiento"}. Si se perdió la respuesta, reintentar este mismo movimiento no lo duplica.`);
    } finally { writeInFlight.current = false; setSaving(false); }
  };

  if (!items.length) {
    if (error) return <p role="alert">{error} No se pudieron comprobar las reposiciones pendientes.</p>;
    if (!loaded) return <p role="status">Consultando ubicaciones…</p>;
    return result ? <p className="replenishment-result" role="status">{result}</p> : null;
  }
  return <section className="replenishment-alerts" aria-label="Reposición de ubicaciones preferentes" aria-busy={loading || saving}>
    <header className="replenishment-heading">
      <CircleAlert size={22} aria-hidden="true" />
      <div><h3>Reponer ubicación preferente{loaded ? ` · ${items.length} productos` : ""}</h3>
        <p>La ubicación preferente está a cero o en negativo y hay existencias en otras ubicaciones del almacén.</p></div>
      <button className="secondary-action" type="button" disabled={loading || saving || !!draft} onClick={() => void refresh()}><RefreshCw size={15} aria-hidden="true" />{loading ? "Consultando…" : "Actualizar avisos"}</button>
    </header>
    {previewCapturedAt && <p className="replenishment-preview">LAB · Copia aislada del {new Date(previewCapturedAt).toLocaleString("es-ES")}. Los traspasos de esta prueba no afectan al almacén real.</p>}
    {error && <p role="alert">{error} Los avisos pueden estar desactualizados.</p>}
    {result && <p className="replenishment-result" role="status">{result}</p>}
    {imageError && <p role="status">{imageError} Puedes continuar consultando las ubicaciones.</p>}
    {items.length > pageSize && <label className="replenishment-search">Buscar producto o ubicación<input disabled={!!draft} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>}
    <div className="replenishment-list">
      {visible.map((item) => {
        const editing = draft?.productId === item.productId;
        const source = editing ? item.sources.find((source) => source.code === draft.fromCode) : null;
        const quantity = editing ? Number(draft.quantity.replace(",", ".")) : 0;
        return <article className="replenishment-product" key={item.productId} aria-label={`Reponer ${item.reference}`}>
          <div className="replenishment-photo">{images[item.productId] ? <img src={images[item.productId]} alt={item.name} loading="lazy" onError={() => setImages((previous) => ({ ...previous, [item.productId]: "" }))} /> : <><Package size={25} aria-hidden="true" /><small>Sin foto</small></>}</div>
          <div className="replenishment-info"><strong>{item.reference}</strong><span>{item.name}</span>
            <p>Preferente <b>{item.preferred.code}</b>: <b>{qty(item.preferred.quantity)} {item.uom}</b>{!item.preferred.active && " · Ubicación inactiva"}</p>
            <ul aria-label="Stock en otras ubicaciones">{item.sources.map((source) => <li key={source.code}><b>{source.code}</b>: {qty(source.quantity)} {item.uom}{!source.active && " · Inactiva"}</li>)}</ul>
          </div>
          {!editing && <button className="primary-action" type="button" disabled={!!draft || !item.preferred.active || !item.sources.some((source) => source.active)} onClick={(event) => {
            trigger.current = event.currentTarget; setResult(""); setSaveError("");
            setDraft({ productId: item.productId, fromCode: item.sources.find((source) => source.active)!.code, quantity: "", requestId: crypto.randomUUID() });
          }}>Reponer</button>}
          {editing && <form className="replenishment-form" onSubmit={(event) => void submit(event)} aria-label={`Traspaso de ${item.reference}`}>
            <label>Ubicación de origen<select aria-label="Ubicación de origen" ref={sourceControl} disabled={saving} value={draft.fromCode} onChange={(event) => { setSaveError(""); setDraft({ ...draft, fromCode: event.target.value, quantity: "", requestId: crypto.randomUUID() }); }}>
              {item.sources.filter((source) => source.active).map((source) => <option key={source.code} value={source.code}>{source.code} · {qty(source.quantity)} {item.uom}</option>)}
            </select></label>
            <span className="replenishment-destination"><ArrowRight size={16} aria-hidden="true" /> Destino: <b>{item.preferred.code}</b></span>
            <label>Cantidad a reponer<input autoComplete="off" inputMode="decimal" required disabled={saving} value={draft.quantity} onChange={(event) => { setSaveError(""); setDraft({ ...draft, quantity: event.target.value, requestId: crypto.randomUUID() }); }} placeholder={`Máximo ${source ? qty(source.quantity) : "—"}`} /></label>
            <p>Tras mover: {item.preferred.code} quedará con {qty(item.preferred.quantity + (Number.isFinite(quantity) ? quantity : 0))} {item.uom}. Registra el traspaso después de mover físicamente las unidades. Solo cambia las ubicaciones del Dashboard; no el stock total de Odoo.</p>
            <div className="replenishment-actions"><button className="primary-action" disabled={saving || !Number.isFinite(quantity) || quantity <= 0 || quantity > (source?.quantity ?? 0)} type="submit">{saving ? "Registrando…" : "Confirmar traspaso"}</button><button className="secondary-action" disabled={saving} type="button" onClick={close}>Cancelar</button></div>
            {saveError && <p role="alert">{saveError}</p>}
          </form>}
        </article>;
      })}
    </div>
    {loaded && filtered.length === 0 && items.length > 0 && <p>No hay productos que coincidan con la búsqueda.</p>}
    {filtered.length > pageSize && <nav className="replenishment-pagination" aria-label="Páginas de reposición"><button type="button" className="secondary-action" disabled={!!draft || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, filtered.length)} de {filtered.length} productos</span><button type="button" className="secondary-action" disabled={!!draft || currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>}
    {!loaded && !error && <p role="status">Consultando ubicaciones…</p>}
  </section>;
}
