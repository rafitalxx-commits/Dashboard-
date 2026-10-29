import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, MapPin, Plus, RefreshCw, Search } from "lucide-react";
import { odooClient } from "../../services/odooClient";
import type { LocationCatalogEntry } from "../../services/odooTypes";
import "./catalogFeedback.css";

type Pending = { kind: "load" | "create" | "toggle"; code?: string };
export function ProductLocationsView() {
  const [locations, setLocations] = useState<LocationCatalogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const inFlight = useRef(false);
  const busy = pending !== null;
  const begin = (next: Pending) => {
    if (inFlight.current) return false;
    inFlight.current = true; setPending(next); setMessage(null); return true;
  };
  const finish = () => { inFlight.current = false; setPending(null); };
  const load = async () => {
    if (!begin({ kind: "load" })) return;
    try { setLocations(await odooClient.getLocationCatalog()); }
    catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "No se pudieron leer las ubicaciones" }); }
    finally { finish(); }
  };
  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    return locations.filter((item) => !term || `${item.code} ${item.label}`.toLocaleLowerCase("es").includes(term));
  }, [locations, query]);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim() || !begin({ kind: "create" })) return;
    try {
      setLocations(await odooClient.createLocationCatalogEntry(code));
      setCode("");
      setMessage({ kind: "success", text: "Ubicación creada y activa. Ya puede seleccionarse en Productos, Inventario y Recepciones." });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "No se pudo crear la ubicación" }); }
    finally { finish(); }
  };
  const toggle = async (item: LocationCatalogEntry) => {
    if (!begin({ kind: "toggle", code: item.code })) return;
    try {
      setLocations(await odooClient.setLocationCatalogEntryActive(item.code, !item.active));
      setMessage({ kind: "success", text: `${item.label} queda ${item.active ? "inactiva" : "activa"}.` });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "No se pudo actualizar la ubicación" }); }
    finally { finish(); }
  };
  const spinner = <LoaderCircle className="catalog-action-spinner" size={16} aria-hidden="true"/>;
  return <section className="product-locations-catalog">
    <header className="products-header"><div><p className="eyebrow">PRODUCTOS · UBICACIONES</p><h1>Catálogo de ubicaciones</h1><p>Único origen de ubicaciones válidas para asignaciones, escáneres, inventarios y recepciones.</p></div><button className="secondary-button" disabled={busy} onClick={() => void load()} type="button">{pending?.kind === "load" ? spinner : <RefreshCw size={16}/>}{pending?.kind === "load" ? "Actualizando…" : "Actualizar"}</button></header>
    <form className="location-catalog-create" aria-label="Crear ubicación física" aria-busy={pending?.kind === "create"} onSubmit={create}><label>Nueva ubicación física<input autoFocus disabled={busy} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="A101"/></label><button className="primary-button" disabled={busy || !code.trim()} type="submit">{pending?.kind === "create" ? spinner : <Plus size={16}/>}{pending?.kind === "create" ? "Creando ubicación…" : "Crear y activar"}</button><small>Formato: fila + estantería + altura, por ejemplo A101. Las recepciones no pueden crear ubicaciones.</small></form>
    {busy && <p className="location-catalog-feedback pending" role="status">{spinner}{pending.kind === "create" ? "Creando y guardando la ubicación…" : pending.kind === "toggle" ? `Actualizando ubicación ${pending.code}…` : "Cargando ubicaciones…"}</p>}
    {message && <p className={`location-catalog-feedback ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
    <label className="location-catalog-search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ubicación"/></label>
    <div className="location-catalog-list">{visible.map((item) => <article key={item.code}><span className={`location-catalog-icon ${item.kind}`}><MapPin size={19}/></span><div><strong>{item.label}</strong><small>{item.kind === "dispatch" ? "Zona operativa · Bajo pedido" : item.code}</small></div><b className={item.active ? "active" : "inactive"}>{item.active ? "Activa" : "Inactiva"}</b><button disabled={busy || item.kind === "dispatch"} onClick={() => void toggle(item)} type="button">{pending?.kind === "toggle" && pending.code === item.code ? <>{spinner}Actualizando…</> : item.active ? "Desactivar" : "Activar"}</button></article>)}</div>
  </section>;
}
