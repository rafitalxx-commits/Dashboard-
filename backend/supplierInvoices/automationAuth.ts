import { createHash, timingSafeEqual } from "node:crypto";

// Separate machine identity, never a fabricated browser session. Call only from
// the three explicitly opted-in inbox handlers; no accounting/archive actions.
export function invoiceAutomationUser(
  request: { method?: string; url?: string; headers: Record<string, unknown> },
  env: Record<string, string | undefined>,
  method: "GET" | "POST",
) {
  if (env.SUPPLIER_INVOICES_AUTOMATION_ENABLED !== "true") return null;
  if ((request.method ?? "GET").toUpperCase() !== method) return null;
  if (new URL(request.url ?? "/", "http://local").pathname !== "/") return null;
  const expected = env.SUPPLIER_INVOICES_AUTOMATION_TOKEN_SHA256 ?? "";
  if (!/^[a-f0-9]{64}$/i.test(expected)) return null;
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !/^Bearer [A-Za-z0-9_-]{43,256}$/.test(authorization)) return null;
  const digest = createHash("sha256").update(authorization.slice(7)).digest();
  if (!timingSafeEqual(digest, Buffer.from(expected, "hex"))) return null;
  return { id: "invoice-automation", name: "Facturas · Preparación automática", role: "service", permissions: ["supplierBilling"] };
}
