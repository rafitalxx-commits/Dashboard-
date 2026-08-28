import { createPrestashopTrackingPublisher } from "./publisher.ts";

type Server = { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } };
type Auth = { getSessionUser: (cookie?: string) => { permissions: string[] } | undefined };

export function registerPrestashopRoutes(server: Server, auth: Auth, env: Record<string, string>) {
  const publisher = createPrestashopTrackingPublisher(env);

  server.middlewares.use("/api/prestashop", async (request, response) => {
    const user = auth.getSessionUser(request.headers.cookie);
    if (!user) return sendJson(response, 401, { message: "Login requerido" });
    if (!user.permissions.includes("expeditions")) return sendJson(response, 403, { message: "Sin permiso de expediciones" });

    const url = new URL(request.url ?? "/", "http://local");
    const path = url.pathname.replace(/^\/+|\/+$/g, "");

    try {
      if (request.method === "GET" && path === "status") {
        return sendJson(response, 200, publisher.status());
      }

      const orderMatch = path.match(/^tracking\/([^/]+)$/);
      if (request.method === "GET" && orderMatch) {
        return sendJson(response, 200, { tracking: publisher.findByOdooOrderId(decodeURIComponent(orderMatch[1])) });
      }

      if (request.method === "GET" && path === "tracking") {
        return sendJson(response, 200, { records: publisher.list().slice(0, 200) });
      }

      if (request.method === "POST" && path === "tracking/prepare") {
        const input = await readJsonBody<Record<string, string>>(request);
        if (!isPrestashopChannel(input.channel)) {
          return sendJson(response, 200, { tracking: null, skipped: true, message: "Pedido no PrestaShop" });
        }
        const tracking = publisher.prepare(input);
        if (env.PRESTASHOP_AUTO_PUBLISH_ENABLED === "true") {
          return sendJson(response, 200, { tracking: await publisher.publishPrestashopTracking(input) });
        }
        return sendJson(response, 202, { tracking });
      }

      if (request.method === "POST" && path === "tracking/retry") {
        const input = await readJsonBody<Record<string, string>>(request);
        if (!isPrestashopChannel(input.channel)) {
          return sendJson(response, 400, { message: "Pedido no PrestaShop" });
        }
        return sendJson(response, 200, { tracking: await publisher.publishPrestashopTracking(input) });
      }

      return sendJson(response, 404, { message: "Ruta PrestaShop no encontrada" });
    } catch (error) {
      return sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudo sincronizar PrestaShop" });
    }
  });
}

function isPrestashopChannel(value?: string) {
  return /website|webside|prestashop|presta/i.test(value || "");
}

async function readJsonBody<T = Record<string, unknown>>(request: { on: Function }): Promise<T> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", resolve);
    request.on("error", reject);
  });
  const raw = Buffer.concat(chunks).toString("utf8");
  return (raw ? JSON.parse(raw) : {}) as T;
}

function sendJson(response: any, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
