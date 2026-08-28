import { useEffect, useState } from "react";
import { downloadWorkerQr } from "./workerQr";

type Worker = { id: string; code: string; name: string; active: boolean };
const apiPath = (path: string) => {
  const match = window.location.pathname.match(/^\/(expeditions-(?:lab|redesign-lab))/);
  return match ? `/${match[1]}${path}` : path;
};

export function WarehouseWorkersSettings() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [name, setName] = useState("");
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const selectedWorker = workers.find((worker) => worker.id === selectedWorkerId);
  const load = async () => { const response = await fetch(apiPath("/api/warehouse-workers")); if (response.ok) setWorkers(((await response.json()) as { workers?: Worker[] }).workers || []); };
  useEffect(() => { void load(); }, []);
  const create = async () => { if (!name.trim()) return; const response = await fetch(apiPath("/api/warehouse-workers"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); if (response.ok) { setName(""); await load(); } };
  const patch = async (worker: Worker, body: Record<string, unknown>) => { const response = await fetch(apiPath(`/api/warehouse-workers/${worker.id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (response.ok) await load(); };
  const remove = async (worker: Worker) => { if (!window.confirm(`¿Eliminar al operario ${worker.name}?`)) return; const response = await fetch(apiPath(`/api/warehouse-workers/${worker.id}`), { method: "DELETE" }); if (response.ok) { await load(); setSelectedWorkerId(null); } };
  const downloadQr = async (worker: Worker) => { await downloadWorkerQr(worker); };
  const closeDrawer = () => setSelectedWorkerId(null);
  return <article className="panel settings-panel workers-settings-panel">
    <div className="worker-list-heading"><div className="section-heading"><span>Operarios de almacén</span><h2>Operarios y códigos QR</h2><p>Los operarios no necesitan usuario ni contraseña.</p></div></div>
    <details className="user-create-card worker-create-card"><summary><span><strong>Añadir operario</strong><small>Se asignará un código OP correlativo.</small></span></summary><div className="user-create-row"><input onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} placeholder="Nombre del operario" value={name} /><button disabled={!name.trim()} onClick={() => void create()} type="button">Crear operario</button></div></details>
    <div className="dashboard-user-list">{workers.length ? workers.map((worker) => <div className="dashboard-user-row worker-list-row" key={worker.id}><span><strong>{worker.name}</strong><small>{worker.code}</small></span><span className={worker.active ? "user-status active" : "user-status inactive"}>{worker.active ? "Activo" : "Inactivo"}</span><button onClick={() => { setName(""); setSelectedWorkerId(worker.id); }} type="button">Gestionar</button></div>) : <p className="workers-empty">Aún no hay operarios creados.</p>}</div>
    {selectedWorker && <><button aria-label="Cerrar gestión de operario" className="drawer-backdrop" onClick={closeDrawer} type="button" /><aside aria-label={`Gestionar ${selectedWorker.name}`} className="worker-management-drawer"><div className="user-drawer-heading"><div><span>Gestionar operario</span><h2>{selectedWorker.name}</h2><p>{selectedWorker.code}</p></div><button aria-label="Cerrar gestión de operario" onClick={closeDrawer} type="button">×</button></div><label className="settings-field">Nombre del operario<input onChange={(event) => setName(event.target.value)} placeholder={selectedWorker.name} value={name || selectedWorker.name} /></label><button className="settings-save-button" onClick={() => void patch(selectedWorker, { name: name.trim() || selectedWorker.name })} type="button">Guardar cambios</button><button className="worker-qr-button" onClick={() => void downloadQr(selectedWorker)} type="button">Descargar QR</button><div className="settings-danger-zone"><strong>Acciones de operario</strong><button onClick={() => void patch(selectedWorker, { active: !selectedWorker.active })} type="button">{selectedWorker.active ? "Desactivar operario" : "Activar operario"}</button><button onClick={() => void remove(selectedWorker)} type="button">Eliminar operario</button></div></aside></>}
  </article>;
}
