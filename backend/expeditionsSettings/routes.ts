import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Server = { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } };
type Auth = { getSessionUser: (cookie?: string) => { permissions: string[] } | undefined };
type ShippingConnector = "genei" | "sendcloud";
type ShippingRule = {
  id: string;
  name: string;
  active: boolean;
  connector: ShippingConnector;
  countries: string[];
  serviceFilter: string;
  selection: "cheapest";
  priority: number;
  updatedAt: string;
};
type ExpeditionsSettings = {
  connectors: Array<{ id: ShippingConnector; label: string; active: boolean; ready: boolean }>;
  rules: ShippingRule[];
  updatedAt: string;
};

export function registerExpeditionsSettingsRoutes(
  server: Server,
  auth: Auth,
  options: { dataDir?: string } = {},
) {
  const repository = createExpeditionsSettingsRepository(options);
  server.middlewares.use("/api/expeditions/settings", async (request, response) => {
    const user = auth.getSessionUser(request.headers.cookie);
    if (!user) return sendJson(response, 401, { message: "Login requerido" });
    if (!user.permissions.includes("expeditions")) return sendJson(response, 403, { message: "Sin permiso de expediciones" });
    const url = new URL(request.url ?? "/", "http://local");
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    try {
      if (request.method === "GET" && !path) return sendJson(response, 200, repository.read());
      if (request.method === "POST" && path === "rules") {
        if (!user.permissions.includes("odooWrite")) return sendJson(response, 403, { message: "Sin permiso para editar reglas" });
        return sendJson(response, 201, repository.createRule(await readJsonBody<Partial<ShippingRule>>(request)));
      }
      const ruleMatch = path.match(/^rules\/([^/]+)$/);
      if (ruleMatch && request.method === "PATCH") {
        if (!user.permissions.includes("odooWrite")) return sendJson(response, 403, { message: "Sin permiso para editar reglas" });
        return sendJson(response, 200, repository.updateRule(ruleMatch[1], await readJsonBody<Partial<ShippingRule>>(request)));
      }
      if (ruleMatch && request.method === "DELETE") {
        if (!user.permissions.includes("odooWrite")) return sendJson(response, 403, { message: "Sin permiso para editar reglas" });
        return sendJson(response, 200, repository.deleteRule(ruleMatch[1]));
      }
      return sendJson(response, 404, { message: "Ruta de configuracion no encontrada" });
    } catch (error) {
      return sendJson(response, 400, { message: error instanceof Error ? error.message : "No se pudo guardar configuracion" });
    }
  });
}

function createExpeditionsSettingsRepository(options: { dataDir?: string }) {
  const storePath = join(options.dataDir ?? process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data", "expeditions-settings.json");

  function read(): ExpeditionsSettings {
    ensureStore();
    return normalizeSettings(JSON.parse(readFileSync(storePath, "utf8")) as Partial<ExpeditionsSettings>);
  }

  function write(settings: ExpeditionsSettings) {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(normalizeSettings(settings), null, 2)}\n`, { mode: 0o600 });
  }

  function ensureStore() {
    if (existsSync(storePath)) return;
    write(defaultSettings());
  }

  function createRule(input: Partial<ShippingRule>) {
    const settings = read();
    const now = new Date().toISOString();
    const rule = normalizeRule({
      ...input,
      id: `rule-${Date.now()}`,
      priority: Math.max(1, settings.rules.length + 1),
      updatedAt: now,
    });
    settings.rules.push(rule);
    settings.updatedAt = now;
    write(settings);
    return { settings, rule };
  }

  function updateRule(ruleId: string, patch: Partial<ShippingRule>) {
    const settings = read();
    const index = settings.rules.findIndex((rule) => rule.id === ruleId);
    if (index < 0) throw new Error("Regla no encontrada");
    const now = new Date().toISOString();
    settings.rules[index] = normalizeRule({ ...settings.rules[index], ...patch, id: ruleId, updatedAt: now });
    settings.updatedAt = now;
    write(settings);
    return { settings, rule: settings.rules[index] };
  }

  function deleteRule(ruleId: string) {
    const settings = read();
    settings.rules = settings.rules.filter((rule) => rule.id !== ruleId);
    settings.updatedAt = new Date().toISOString();
    write(settings);
    return { settings };
  }

  return { createRule, deleteRule, read, updateRule };
}

function defaultSettings(): ExpeditionsSettings {
  const now = new Date().toISOString();
  return {
    connectors: [
      { id: "genei", label: "Genei", active: true, ready: true },
      { id: "sendcloud", label: "Sendcloud", active: false, ready: false },
    ],
    rules: [
      {
        id: "rule-fedex-eu",
        name: "Francia, Italia y Alemania",
        active: true,
        connector: "genei",
        countries: ["FR", "IT", "DE"],
        serviceFilter: "FEDEX|GLOBAL EXPRESS",
        selection: "cheapest",
        priority: 1,
        updatedAt: now,
      },
      {
        id: "rule-default",
        name: "Resto de destinos",
        active: true,
        connector: "genei",
        countries: [],
        serviceFilter: "",
        selection: "cheapest",
        priority: 99,
        updatedAt: now,
      },
    ],
    updatedAt: now,
  };
}

function normalizeSettings(value: Partial<ExpeditionsSettings>): ExpeditionsSettings {
  const defaults = defaultSettings();
  return {
    connectors: value.connectors?.length ? value.connectors : defaults.connectors,
    rules: (value.rules?.length ? value.rules : defaults.rules).map(normalizeRule).sort((left, right) => left.priority - right.priority),
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
}

function normalizeRule(rule: Partial<ShippingRule>): ShippingRule {
  return {
    id: String(rule.id || `rule-${Date.now()}`),
    name: String(rule.name || "Nueva regla").trim(),
    active: rule.active !== false,
    connector: rule.connector === "sendcloud" ? "sendcloud" : "genei",
    countries: Array.from(new Set((rule.countries || []).map((country) => String(country).trim().toUpperCase()).filter(Boolean))),
    serviceFilter: String(rule.serviceFilter || "").trim(),
    selection: "cheapest",
    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 99,
    updatedAt: rule.updatedAt || new Date().toISOString(),
  };
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
