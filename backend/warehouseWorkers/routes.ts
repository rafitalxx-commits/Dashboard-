import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Server = { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } };
type Auth = { getSessionUser: (cookie?: string) => { permissions: string[] } | undefined };
export type WarehouseWorker = { id: string; code: string; name: string; active: boolean; createdAt: string; updatedAt: string };
type Activity = { id: string; workerId: string; workerCode: string; workerName: string; orderRef: string; rawReference?: string; resolvedOrderRef?: string; carrier?: string; tracking?: string; result: "label-created" | "simulated-label" | "scan-accepted" | "scan-blocked-unprinted" | "error"; createdAt: string };

export function registerWarehouseWorkersRoutes(server: Server, auth: Auth, options: { dataDir?: string } = {}) {
  const dataDir = options.dataDir ?? process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data";
  const workersPath = join(dataDir, "warehouse-workers.json");
  const activityPath = join(dataDir, "warehouse-worker-activity.json");
  const read = (): WarehouseWorker[] => existsSync(workersPath) ? JSON.parse(readFileSync(workersPath, "utf8")) : [];
  const write = (workers: WarehouseWorker[]) => { mkdirSync(dirname(workersPath), { recursive: true }); writeFileSync(workersPath, `${JSON.stringify(workers, null, 2)}\n`, { mode: 0o600 }); };
  const readBody = async <T,>(request: any): Promise<T> => { const chunks: Buffer[] = []; await new Promise<void>((resolve, reject) => { request.on("data", (chunk: Buffer) => chunks.push(chunk)); request.on("end", resolve); request.on("error", reject); }); return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T; };
  const send = (response: any, status: number, body: unknown) => { response.statusCode = status; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.end(JSON.stringify(body)); };
  server.middlewares.use("/api/warehouse-workers", async (request, response) => {
    const user = auth.getSessionUser(request.headers.cookie);
    if (!user) return send(response, 401, { message: "Login requerido" });
    const path = new URL(request.url ?? "/", "http://local").pathname.replace(/^\/+|\/+$/g, "");
    const isOperationalRoute = /^resolve\//.test(path) || /^activity\/order\//.test(path) || (request.method === "POST" && path === "activity");
    const isStatisticsRoute = request.method === "GET" && (path === "statistics" || path === "statistics/workers");
    const canResolveWorker = /^resolve\//.test(path)
      && (user.permissions.includes("expeditions") || user.permissions.includes("products"));
    if (isStatisticsRoute ? !user.permissions.includes("dashboard") : isOperationalRoute ? !canResolveWorker && !user.permissions.includes("expeditions") : !user.permissions.includes("settings")) return send(response, 403, { message: isStatisticsRoute ? "Sin permiso para ver estadísticas" : isOperationalRoute ? "Sin permiso operativo" : "La gestión de operarios está restringida a Configuración" });
    try {
      if (isStatisticsRoute) {
        if (path === "statistics/workers") return send(response, 200, { workers: read().filter((worker) => worker.active).sort((left, right) => left.name.localeCompare(right.name)) });
        const activities: Activity[] = existsSync(activityPath) ? JSON.parse(readFileSync(activityPath, "utf8")) : [];
        return send(response, 200, { activities: activities.filter((activity) => activity.result === "label-created" || activity.result === "simulated-label"), generatedAt: new Date().toISOString() });
      }
      if (request.method === "GET" && !path) return send(response, 200, { workers: read().sort((a, b) => a.code.localeCompare(b.code)) });
      const resolveMatch = path.match(/^resolve\/([^/]+)$/);
      if (request.method === "GET" && resolveMatch) {
        const code = decodeURIComponent(resolveMatch[1]).trim().toUpperCase();
        const worker = read().find((item) => item.active && item.code === code);
        return worker ? send(response, 200, { worker }) : send(response, 404, { message: "QR de operario no activo" });
      }
      const activityOrderMatch = path.match(/^activity\/order\/([^/]+)$/);
      if (request.method === "GET" && activityOrderMatch) {
        const orderRef = decodeURIComponent(activityOrderMatch[1]).trim().toUpperCase();
        const activities: Activity[] = existsSync(activityPath) ? JSON.parse(readFileSync(activityPath, "utf8")) : [];
        const activity = activities.find((item) => item.orderRef.trim().toUpperCase() === orderRef && (item.result === "label-created" || item.result === "simulated-label"));
        return send(response, 200, { activity: activity || null });
      }
      if (request.method === "POST" && !path) {
        const input = await readBody<{ name?: string }>(request); const name = String(input.name || "").trim(); if (!name) throw new Error("Indica el nombre del operario");
        const workers = read(); const number = Math.max(0, ...workers.map((item) => Number(item.code.replace(/^OP/, "")) || 0)) + 1; const now = new Date().toISOString(); const worker: WarehouseWorker = { id: `OP${String(number).padStart(3, "0")}`, code: `OP${String(number).padStart(3, "0")}`, name, active: true, createdAt: now, updatedAt: now }; workers.push(worker); write(workers); return send(response, 201, { worker, workers });
      }
      const workerMatch = path.match(/^([^/]+)$/);
      if (workerMatch && request.method === "PATCH") {
        const input = await readBody<{ name?: string; active?: boolean }>(request); const workers = read(); const index = workers.findIndex((item) => item.id === decodeURIComponent(workerMatch[1])); if (index < 0) return send(response, 404, { message: "Operario no encontrado" }); const current = workers[index]; workers[index] = { ...current, name: input.name === undefined ? current.name : String(input.name).trim() || current.name, active: input.active === undefined ? current.active : Boolean(input.active), updatedAt: new Date().toISOString() }; write(workers); return send(response, 200, { worker: workers[index], workers });
      }
      if (workerMatch && request.method === "DELETE") {
        const workers = read(); const index = workers.findIndex((item) => item.id === decodeURIComponent(workerMatch[1])); if (index < 0) return send(response, 404, { message: "Operario no encontrado" }); workers.splice(index, 1); write(workers); return send(response, 200, { workers });
      }
      if (request.method === "POST" && path === "activity") {
        const input = await readBody<Partial<Activity>>(request); if (!input.workerId || !input.orderRef) throw new Error("Falta operario o pedido"); const result = input.result === "error" || input.result === "simulated-label" || input.result === "scan-accepted" || input.result === "scan-blocked-unprinted" ? input.result : "label-created"; const activity: Activity = { id: `activity-${Date.now()}`, workerId: String(input.workerId), workerCode: String(input.workerCode || input.workerId), workerName: String(input.workerName || "Operario"), orderRef: String(input.orderRef), rawReference: input.rawReference ? String(input.rawReference) : undefined, resolvedOrderRef: input.resolvedOrderRef ? String(input.resolvedOrderRef) : undefined, carrier: input.carrier ? String(input.carrier) : undefined, tracking: input.tracking ? String(input.tracking) : undefined, result, createdAt: new Date().toISOString() }; const events: Activity[] = existsSync(activityPath) ? JSON.parse(readFileSync(activityPath, "utf8")) : []; mkdirSync(dirname(activityPath), { recursive: true }); writeFileSync(activityPath, `${JSON.stringify([activity, ...events], null, 2)}\n`, { mode: 0o600 }); return send(response, 201, { activity });
      }
      return send(response, 404, { message: "Ruta de operarios no encontrada" });
    } catch (error) { return send(response, 400, { message: error instanceof Error ? error.message : "No se pudo guardar operario" }); }
  });
}
