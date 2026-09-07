import { FormEvent, useEffect, useMemo, useState } from "react";
import { MapPin, Plus, RefreshCw, Search } from "lucide-react";
import { odooClient } from "../../services/odooClient";
import type { LocationCatalogEntry } from "../../services/odooTypes";

export function ProductLocationsView() {
  const [locations, setLocations] = useState<LocationCatalogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = async () => {
    setBusy(true);
    try { setLocations(await odooClient.getLocationCatalog()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudieron leer las ubicaciones"); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    return locations.filter((item) => !term || `${item.code} ${item.label}`.toLocaleLowerCase("es").includes(term));
  }, [locations, query]);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true); setMessage("");
    try {
      setLocations(await odooClient.createLocationCatalogEntry(code));
      setCode("");
      setMessage("Ubicación creada y activa. Ya puede seleccionarse en Productos, Inventario y Recepciones.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo crear la ubicación"); }
    finally { setBusy(false); }
  };
  const toggle = async (item: LocationCatalogEntry) => {
    setBusy(true); setMessage("");
    try {
      setLocations(await odooClient.setLocationCatalogEntryActive(item.code, !item.active));
      setMessage(`${item.label} queda ${item.active ? "inactiva" : "activa"}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo actualizar la ubicación"); }
    finally { setBusy(false); }
  };
  return <section className="product-locations-catalog">
    <header className="products-header"><div><p className="eyebrow">PRODUCTOS · UBICACIONES</p><h1>Catálogo de ubicaciones</h1><p>Único origen de ubicaciones válidas para asignaciones, escáneres, inventarios y recepciones.</p></div><button className="secondary-button" disabled={busy} onClick={() => void load()} type="button"><RefreshCw size={16}/>Actualizar</button></header>
    <form className="location-catalog-create" onSubmit={create}><label>Nueva ubicación física<input autoFocus value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="A101"/></label><button className="primary-button" disabled={busy || !code.trim()}><Plus size={16}/>Crear y activar</button><small>Formato: fila + estantería + altura, por ejemplo A101. Las recepciones no pueden crear ubicaciones.</small></form>
    <label className="location-catalog-search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ubicación"/></label>
    {message && <p className="products-message">{message}</p>}
    <div className="location-catalog-list">{visible.map((item) => <article key={item.code}><span className={`location-catalog-icon ${item.kind}`}><MapPin size={19}/></span><div><strong>{item.label}</strong><small>{item.kind === "dispatch" ? "Zona operativa · Bajo pedido" : item.code}</small></div><b className={item.active ? "active" : "inactive"}>{item.active ? "Activa" : "Inactiva"}</b><button disabled={busy || item.kind === "dispatch"} onClick={() => void toggle(item)} type="button">{item.active ? "Desactivar" : "Activar"}</button></article>)}</div>
  </section>;
}
