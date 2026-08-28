import { createShippingRulesRepository } from "./repository.ts";
import { resolveShippingRule } from "./engine.ts";
import type { ShippingRule, ShippingRuleOrderInput } from "./types.ts";

type Server = { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } };
type Auth = { getSessionUser: (cookie?: string) => { permissions: string[] } | undefined };

export function registerShippingRulesRoutes(server: Server, auth: Auth, options: { dataDir?: string } = {}) {
  const repository = createShippingRulesRepository(options);
  server.middlewares.use("/api/shipping/rules", async (request, response) => {
    const user = auth.getSessionUser(request.headers.cookie);
    if (!user) return sendJson(response, 401, { message: "Login requerido" });
    if (!user.permissions.includes("expeditions")) return sendJson(response, 403, { message: "Sin permiso de expediciones" });
    const url = new URL(request.url ?? "/", "http://local");
    const path = url.pathname.replace(/^\/+|\/+$/g, "");

    try {
      if (request.method === "GET" && !path) return sendJson(response, 200, repository.read());
      if (request.method === "POST" && !path) {
        requireWrite(user);
        return sendJson(response, 201, repository.createRule(await readJsonBody<Partial<ShippingRule>>(request)));
      }
      if (request.method === "POST" && (path === "diagnose" || path === "resolve")) {
        const input = await readJsonBody<{ order?: ShippingRuleOrderInput; forceRuleId?: string }>(request);
        return sendJson(response, 200, resolveShippingRule(repository.read().rules, input.order || {}, input.forceRuleId));
      }
      const duplicateMatch = path.match(/^([^/]+)\/duplicate$/);
      if (request.method === "POST" && duplicateMatch) {
        requireWrite(user);
        return sendJson(response, 201, repository.duplicateRule(decodeURIComponent(duplicateMatch[1])));
      }
      const ruleMatch = path.match(/^([^/]+)$/);
      if (ruleMatch && request.method === "PATCH") {
        requireWrite(user);
        return sendJson(response, 200, repository.updateRule(decodeURIComponent(ruleMatch[1]), await readJsonBody<Partial<ShippingRule>>(request)));
      }
      if (ruleMatch && request.method === "DELETE") {
        requireWrite(user);
        return sendJson(response, 200, repository.deleteRule(decodeURIComponent(ruleMatch[1])));
      }
      return sendJson(response, 404, { message: "Ruta de reglas de transporte no encontrada" });
    } catch (error) {
      return sendJson(response, 400, { message: error instanceof Error ? error.message : "No se pudo gestionar la regla" });
    }
  });
}

function requireWrite(user: { permissions: string[] }) {
  if (!user.permissions.includes("odooWrite")) throw new Error("Sin permiso para editar reglas");
}

async function readJsonBody<T = Record<string, unknown>>(request: { on: Function }): Promise<T> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => { request.on("data", (chunk: Buffer) => chunks.push(chunk)); request.on("end", resolve); request.on("error", reject); });
  const raw = Buffer.concat(chunks).toString("utf8");
  return (raw ? JSON.parse(raw) : {}) as T;
}

function sendJson(response: any, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
