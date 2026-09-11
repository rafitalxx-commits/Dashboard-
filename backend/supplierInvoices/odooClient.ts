// Cliente Odoo minimo y aislado para el modulo Facturas de proveedor (Fase 1, SOLO LECTURA).
// Replica el patron JSON-RPC usado por el resto del Dashboard sin acoplarse a vite.config.ts.

export type OdooConfig = {
  url: string;
  database: string;
  username: string;
  apiKey: string;
};

export function getOdooConfig(env: Record<string, string | undefined>): OdooConfig {
  return {
    url: env.ODOO_URL ?? "",
    database: env.ODOO_DATABASE ?? "",
    username: env.ODOO_USERNAME ?? "",
    apiKey: env.ODOO_API_KEY ?? "",
  };
}

export function hasOdooConfig(config: OdooConfig): boolean {
  return Boolean(config.url && config.database && config.username && config.apiKey);
}

async function rpc(url: string, service: string, method: string, args: unknown[]): Promise<unknown> {
  const response = await fetch(`${url}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args } }),
  });
  const json = (await response.json()) as { error?: unknown; result?: unknown };
  if (json.error) {
    const message = JSON.stringify(json.error).slice(0, 400);
    throw new Error(`Odoo RPC error: ${message}`);
  }
  return json.result;
}

export async function authenticate(config: OdooConfig): Promise<number> {
  const uid = await rpc(config.url, "common", "authenticate", [
    config.database,
    config.username,
    config.apiKey,
    {},
  ]);
  if (!uid) throw new Error("Odoo no ha aceptado el usuario/API key");
  return uid as number;
}

export async function executeKw(
  config: OdooConfig,
  uid: number,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
): Promise<unknown> {
  return rpc(config.url, "object", "execute_kw", [
    config.database,
    uid,
    config.apiKey,
    model,
    method,
    args,
    kwargs,
  ]);
}

export async function searchRead(
  config: OdooConfig,
  uid: number,
  model: string,
  domain: unknown[],
  fields: string[],
  options: { order?: string; limit?: number; offset?: number } = {},
): Promise<Record<string, unknown>[]> {
  const result = await executeKw(config, uid, model, "search_read", [domain], {
    fields,
    order: options.order ?? "",
    limit: options.limit ?? 0,
    offset: options.offset ?? 0,
  });
  return (result ?? []) as Record<string, unknown>[];
}

export async function readRows(
  config: OdooConfig,
  uid: number,
  model: string,
  ids: number[],
  fields: string[],
): Promise<Record<string, unknown>[]> {
  if (!ids.length) return [];
  const result = await executeKw(config, uid, model, "read", [ids], { fields });
  return (result ?? []) as Record<string, unknown>[];
}

export async function searchIds(
  config: OdooConfig,
  uid: number,
  model: string,
  domain: unknown[],
  options: { order?: string } = {},
): Promise<number[]> {
  const result = await executeKw(config, uid, model, "search", [domain], {
    order: options.order ?? "",
  });
  return (result ?? []) as number[];
}

export async function paginatedRead(
  config: OdooConfig,
  uid: number,
  model: string,
  ids: number[],
  fields: string[],
  pageSize = 250,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += pageSize) {
    const chunk = ids.slice(i, i + pageSize);
    rows.push(...(await readRows(config, uid, model, chunk, fields)));
  }
  return rows;
}