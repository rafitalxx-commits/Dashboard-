import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Server = { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } };
type Auth = { getSessionUser: (cookie?: string) => { permissions: string[] } | undefined };
type Destination = { name: string; address: string; postalCode: string; town: string; country: string; phone: string; email: string };
type Override = { orderRef: string; destination: Destination; createdAt: string; updatedAt: string };

const readBody = async <T,>(request: any): Promise<T> => {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => { request.on("data", (chunk: Buffer) => chunks.push(chunk)); request.on("end", resolve); request.on("error", reject); });
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
};

export function registerExpeditionDestinationOverridesRoutes(server: Server, auth: Auth, options: { dataDir?: string } = {}) {
  const file = join(options.dataDir ?? process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data", "expedition-destination-overrides.json");
  const read = (): Override[] => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  const write = (items: Override[]) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(items, null, 2)}\n`, { mode: 0o600 }); };
  const send = (response: any, status: number, body: unknown) => { response.statusCode = status; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.end(JSON.stringify(body)); };
  server.middlewares.use("/api/expedition-destination-overrides", async (request, response) => {
    const user = auth.getSessionUser(request.headers.cookie);
    if (!user) return send(response, 401, { message: "Login requerido" });
    if (!user.permissions.includes("expeditions")) return send(response, 403, { message: "Sin permiso de expediciones" });
    const path = new URL(request.url ?? "/", "http://local").pathname.replace(/^\/+|\/+$/g, "");
    const orderRef = decodeURIComponent(path).trim().toUpperCase();
    if (!orderRef) return send(response, 400, { message: "Falta referencia del pedido" });
    try {
      if (request.method === "GET") return send(response, 200, { override: read().find((item) => item.orderRef === orderRef) ?? null });
      if (request.method === "DELETE") { write(read().filter((item) => item.orderRef !== orderRef)); return send(response, 200, { removed: true }); }
      if (request.method === "PUT") {
        const body = await readBody<{ destination?: Partial<Destination> }>(request);
        const raw = body.destination ?? {};
        const destination: Destination = { name: String(raw.name ?? "").trim(), address: String(raw.address ?? "").trim(), postalCode: String(raw.postalCode ?? "").trim(), town: String(raw.town ?? "").trim(), country: String(raw.country ?? "").trim().toUpperCase(), phone: String(raw.phone ?? "").trim(), email: String(raw.email ?? "").trim() };
        if (!destination.name || !destination.address || !destination.postalCode || !destination.town || !destination.country) throw new Error("Completa nombre, dirección, CP, población y país");
        const now = new Date().toISOString(); const items = read(); const current = items.find((item) => item.orderRef === orderRef); const override: Override = { orderRef, destination, createdAt: current?.createdAt ?? now, updatedAt: now };
        write([override, ...items.filter((item) => item.orderRef !== orderRef)]);
        return send(response, 200, { override });
      }
      return send(response, 404, { message: "Ruta no encontrada" });
    } catch (error) { return send(response, 400, { message: error instanceof Error ? error.message : "No se pudo guardar la dirección temporal" }); }
  });
}
