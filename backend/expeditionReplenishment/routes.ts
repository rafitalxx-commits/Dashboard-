import type { IncomingMessage, ServerResponse } from "node:http";
import type { createExpeditionReplenishment } from "./service";

type Server = { middlewares: { use: (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void } };
type Auth = { getSessionUser: (cookie?: string) => { permissions: string[] } | null | undefined };
const send = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

export function registerExpeditionReplenishmentRoutes(server: Server, auth: Auth, service: ReturnType<typeof createExpeditionReplenishment>, images: (ids: number[]) => Promise<Record<string, string>>, previewCapturedAt?: string) {
  server.middlewares.use("/api/expeditions/replenishment", async (req, res) => {
    const user = auth.getSessionUser(req.headers.cookie);
    if (!user) return send(res, 401, { message: "Login requerido" });
    if (!user.permissions.includes("expeditions")) return send(res, 403, { message: "Sin permiso de expediciones" });
    const url = new URL(req.url ?? "/", "http://local");
    try {
      if (req.method === "GET" && url.pathname === "/") return send(res, 200, { items: service.list(), previewCapturedAt });
      if (req.method === "GET" && url.pathname === "/images") {
        const allowed = new Set(service.list().map((item) => item.productId));
        const ids = [...new Set((url.searchParams.get("ids") || "").split(",").map(Number))].filter((id) => allowed.has(id)).slice(0, 60);
        return send(res, 200, ids.length ? await images(ids) : {});
      }
      if (req.method === "POST" && url.pathname === "/transfer") {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 8192) throw new Error("Solicitud demasiado grande");
          chunks.push(chunk);
        }
        return send(res, 200, service.transfer(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
      }
      return send(res, 405, { message: "Método o ruta no permitido" });
    } catch (error) {
      return send(res, 400, { message: error instanceof Error ? error.message : "No se pudo procesar la reposición" });
    }
  });
}
