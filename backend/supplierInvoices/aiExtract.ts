// Fase 2.2 — Extraccion IA de facturas de proveedor (via OpenRouter).
// PDFs con texto -> LLM de texto (gpt-4o-mini). PDFs escaneados sin texto -> LLM con
// entrada de archivo (Gemini, OCR incluido). Solo lectura del PDF cacheado del LAB.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
const pdfParse = createRequire(import.meta.url)("pdf-parse") as typeof import("pdf-parse");
import { normalizeRate, normalizeSupplierName } from "./documentInbox.ts";
import type { PdfExtractedData, PdfExtractedLine } from "./phase2Types.ts";

type Env = Record<string, string | undefined>;

export interface AiInvoiceFields {
  supplier: string | null;
  supplierVat: string | null;
  country: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  base: number | null;
  taxes: number | null;
  total: number | null;
  lines: PdfExtractedLine[];
  confidence: number | null;
  warnings: string[];
}

export interface AiExtractOutcome {
  fields: AiInvoiceFields;
  model: string;
  mode: "text" | "file";
}

export function aiExtractConfig(env: Env) {
  const apiKey =
    env.SUPPLIER_INVOICES_AI_API_KEY ??
    env.AMAZON_MESSAGES_AI_API_KEY ??
    env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    url:
      env.SUPPLIER_INVOICES_AI_BASE_URL ??
      env.AMAZON_MESSAGES_AI_BASE_URL ??
      "https://openrouter.ai/api/v1/chat/completions",
    textModel:
      env.SUPPLIER_INVOICES_AI_MODEL ??
      env.AMAZON_MESSAGES_AI_MODEL ??
      "openai/gpt-4o-mini",
    fileModel: env.SUPPLIER_INVOICES_AI_FILE_MODEL ?? "google/gemini-2.5-flash",
    maxTokens: Number(env.SUPPLIER_INVOICES_AI_MAX_TOKENS ?? 8000),
    timeoutMs: Number(
      env.SUPPLIER_INVOICES_AI_TIMEOUT_MS ??
        env.AMAZON_MESSAGES_AI_TIMEOUT_MS ??
        90_000,
    ),
  };
}

const SYSTEM_PROMPT = [
  "Extraes datos estructurados de facturas de proveedor para TodoElectrico (distribucion electrica; proveedores ES/UE y ocasionales CN/US).",
  "Respondes SOLO con un objeto JSON valido, sin markdown ni texto alrededor.",
  "Reglas:",
  "- Nunca inventes datos: si algo no aparece con certeza usa null.",
  "- supplier es la razón social del EMISOR, no comprador/cliente, dirección, vehículo, empleado, instalador/montador ni etiqueta de campo.",
  "- Identifica emisor por el bloque de cabecera y su NIF/CIF/VAT etiquetado; no uses el primer número fiscal del documento si está junto al cliente. Si emisor o NIF no son inequívocos, usa null y añade warning.",
  "- Fechas SIEMPRE en ISO yyyy-mm-dd (convierte dd/mm/yyyy si hace falta).",
  "- Importes como numero con punto decimal, sin simbolos ni separadores. base = sin impuestos, taxes = impuestos, total = total a pagar.",
  "- currency: codigo ISO (EUR, USD, GBP...).",
  "- supplierVat: NIF/CIF/VAT tal cual aparece, con prefijo de pais si lo tiene.",
  "- lines: solo conceptos de factura (nunca subtotales ni lineas de IVA), maximo 60.",
  "- Distingue descuentos sucesivos explícitos: discount=comercial, discountExtra=adicional y promptPaymentDiscount=pronto pago. No los sumes; usa null si no constan en el PDF.",
  "- confidence: 0-100 segun lo claro que era el documento.",
  "- warnings: avisos en espanol sobre ambiguedades.",
  'Esquema: {"supplier":string|null,"supplierVat":string|null,"country":string|null,"invoiceNumber":string|null,"invoiceDate":string|null,"dueDate":string|null,"currency":string|null,"base":number|null,"taxes":number|null,"total":number|null,"lines":[{"description":string,"reference":string|null,"quantity":number|null,"priceUnit":number|null,"discount":number|null,"discountExtra":number|null,"promptPaymentDiscount":number|null,"taxNames":[string],"total":number|null}],"confidence":number,"warnings":[string]}',
].join("\n");

function parseJsonLoose(raw: string): Record<string, unknown> {
  const trimmed = (raw ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("La IA no devolvio JSON");
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

function isoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const eu = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (eu) {
    const day = eu[1].padStart(2, "0");
    const month = eu[2].padStart(2, "0");
    const d = new Date(`${eu[3]}-${month}-${day}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : `${eu[3]}-${month}-${day}`;
  }
  return null;
}

function num2(v: unknown): number | null {
  const n =
    typeof v === "string"
      ? Number(v.replace(/\s/g, "").replace(",", "."))
      : typeof v === "number"
        ? v
        : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function unitPrice3(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/\s/g, "").replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

function percent(v: unknown): number | null {
  const n = num2(v);
  return n != null && n >= 0 && n <= 100 ? n : null;
}

function str(v: unknown, max = 80): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function sanitizeFields(parsed: Record<string, unknown>): AiInvoiceFields {
  const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
  const lines: PdfExtractedLine[] = rawLines
    .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === "object")
    .map((l) => ({
      description: str(l.description, 200) ?? "(concepto)",
      reference: str(l.reference, 60),
      quantity: num2(l.quantity),
      priceUnit: unitPrice3(l.priceUnit),
      discount: percent(l.discount),
      discountExtra: percent(l.discountExtra),
      promptPaymentDiscount: percent(l.promptPaymentDiscount),
      taxNames: Array.isArray(l.taxNames)
        ? l.taxNames.filter((t): t is string => typeof t === "string").slice(0, 4)
        : [],
      total: num2(l.total),
      confidence: 85,
    }))
    .filter((l) => l.description !== "(concepto)" || l.total != null)
    .slice(0, 60);
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((w): w is string => typeof w === "string").slice(0, 5)
    : [];
  const conf = num2(parsed.confidence);
  const country = str(parsed.country, 20);
  return {
    supplier: str(parsed.supplier, 120),
    supplierVat: str(parsed.supplierVat, 30),
    country: country ? (country.length === 2 ? country.toUpperCase() : country) : null,
    invoiceNumber: str(parsed.invoiceNumber, 60),
    invoiceDate: isoDate(parsed.invoiceDate),
    dueDate: isoDate(parsed.dueDate),
    currency: str(parsed.currency, 8) ? normalizeRate(str(parsed.currency, 8) ?? "EUR") : null,
    base: num2(parsed.base),
    taxes: num2(parsed.taxes),
    total: num2(parsed.total),
    lines,
    confidence: conf != null ? Math.max(0, Math.min(100, conf)) : null,
    warnings,
  };
}

async function callOpenRouter(
  cfg: NonNullable<ReturnType<typeof aiExtractConfig>>,
  messages: unknown[],
  model: string,
): Promise<Record<string, unknown>> {
  // Hasta 3 intentos: el 402 con "can only afford N" se reajusta a un max_tokens
  // que quepa en el saldo; si el modelo devuelve texto no-JSON (tier free inestable)
  // se reintenta con backoff en vez de abortar la extraccion.
  let maxTokens = cfg.maxTokens;
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const response = await fetch(cfg.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://dashboard.todoelectrico.net",
          "X-Title": "TodoElectrico Dashboard Facturas Proveedor",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages,
        }),
        signal: controller.signal,
      });
      const bodyText = await response.text();
      if (response.status === 402) {
        const m = bodyText.match(/can only afford (\d+)/);
        if (m && attempt === 0) {
          maxTokens = Math.max(64, Number(m[1]) - 8);
          continue;
        }
        throw new Error(`OpenRouter 402: ${bodyText.slice(0, 220)}`);
      }
      if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${bodyText.slice(0, 300)}`);
      const payload = JSON.parse(bodyText) as {
        choices?: { message?: { content?: unknown } }[];
        error?: { message?: string };
      };
      if (payload.error?.message) throw new Error(`OpenRouter: ${payload.error.message}`);
      const content = payload.choices?.[0]?.message?.content;
      const raw = typeof content === "string" ? content : JSON.stringify(content ?? "");
      try {
        return parseJsonLoose(raw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isJsonParse =
          msg.includes("La IA no devolvio JSON") ||
          msg.includes("JSON.parse") ||
          msg.includes("Unexpected token");
        if (!isJsonParse || attempt === maxAttempts - 1) throw err;
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("OpenRouter: reintentos agotados");
}

/** Fusiona heuristica local + IA. La IA solo sobreescribe cuando aporta dato mejor. */
export function mergeExtracted(
  base: PdfExtractedData | null,
  ai: AiInvoiceFields,
  note: string,
): PdfExtractedData {
  const b: PdfExtractedData = base ?? {
    supplier: null, supplierVat: null, country: null, invoiceNumber: null, invoiceDate: null,
    dueDate: null, currency: null, base: null, taxes: null, total: null, lines: [],
    textPreview: "", needsOcr: false, warnings: [], pdfPages: 0,
    billingAddress: null, docType: null,
  };
  const warnings = b.warnings.filter((w) => !w.includes("OCR pendiente") && !w.includes("fase posterior"));
  warnings.push(note);
  warnings.push(...ai.warnings.slice(0, 3));
  const normalizeVat = (value: string | null) => (value ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase().replace(/^[A-Z]{2}/, "");
  const baseVat = normalizeVat(b.supplierVat);
  const aiVat = normalizeVat(ai.supplierVat);
  const conflictingFiscalEvidence = Boolean(baseVat && aiVat && baseVat !== aiVat);
  const aiNameConflictsWithKnownVat = Boolean(
    b.supplier && ai.supplier && baseVat &&
    normalizeSupplierName(b.supplier) !== normalizeSupplierName(ai.supplier) &&
    (!aiVat || conflictingFiscalEvidence),
  );
  const preserveBaseSupplier = conflictingFiscalEvidence || aiNameConflictsWithKnownVat;
  if (preserveBaseSupplier) warnings.push("La IA discrepa del emisor/NIF detectado localmente; se conserva el dato local y requiere revisión humana.");
  return {
    supplier: preserveBaseSupplier ? b.supplier : ai.supplier ?? b.supplier,
    supplierVat: preserveBaseSupplier ? b.supplierVat : ai.supplierVat ?? b.supplierVat,
    country: ai.country ?? b.country,
    invoiceNumber: ai.invoiceNumber ?? b.invoiceNumber,
    invoiceDate: ai.invoiceDate ?? b.invoiceDate,
    dueDate: ai.dueDate ?? b.dueDate,
    currency: ai.currency ?? b.currency,
    base: ai.base ?? b.base,
    taxes: ai.taxes ?? b.taxes,
    total: ai.total ?? b.total,
    lines: ai.lines.length ? ai.lines : b.lines,
    textPreview: b.textPreview,
    needsOcr: false,
    warnings: warnings.slice(0, 8),
    pdfPages: b.pdfPages,
    billingAddress: b.billingAddress ?? null,
    docType: b.docType ?? null,
  };
}

/** Extrae datos de un PDF cacheado en el LAB. Con texto -> LLM texto; escaneado -> LLM con PDF binario (OCR). */
export async function aiExtractCachedPdf(
  env: Env,
  driveFileId: string,
  fileName: string,
  pdfDir: string,
): Promise<AiExtractOutcome> {
  const cfg = aiExtractConfig(env);
  if (!cfg) throw new Error("IA no configurada: falta SUPPLIER_INVOICES_AI_API_KEY o AMAZON_MESSAGES_AI_API_KEY");
  const path = join(pdfDir, `${driveFileId}.pdf`);
  if (!existsSync(path)) throw new Error("PDF no cacheado; ejecuta un escaneo de Drive primero");
  const buffer = readFileSync(path);
  if (buffer.length > 12 * 1024 * 1024) throw new Error("PDF demasiado grande para el LAB (>12MB)");
  const parsed = await pdfParse(buffer);
  const text = parsed.text ?? "";
  if (text.trim().length >= 40) {
    // Clamp de entrada para no exceder el presupuesto de tokens disponible
    const compact = cfg.maxTokens < 500;
    const clipped = text.slice(0, compact ? 4500 : 6000);
    const messages = [
      { role: "system", content: SYSTEM_PROMPT + (compact ? "\n\nIMPORTANTE: el presupuesto de respuesta es muy reducido. Devuelve SOLO supplier, supplierVat, country, invoiceNumber, invoiceDate, dueDate, currency, base, taxes, total, confidence y warnings (max 2), con lines: [] y los warnings en una sola frase corta. JSON compacto, sin espacios innecesarios." : "") },
      {
        role: "user",
        content: `Archivo: ${fileName}\nTexto extraido del PDF (${parsed.numpages ?? "?"} paginas):\n\n${clipped}${text.length > clipped.length ? "\n\n[...texto truncado...]" : ""}`,
      },
    ];
    const out = await callOpenRouter(cfg, messages, cfg.textModel);
    return { fields: sanitizeFields(out), model: cfg.textModel, mode: "text" };
  }
  // PDF escaneado: modelo con entrada de archivo hace OCR del PDF directamente
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: `Archivo: ${fileName}. Extrae los datos de esta factura PDF escaneada.` },
        {
          type: "file",
          file: {
            filename: fileName,
            file_data: { data: buffer.toString("base64"), mime_type: "application/pdf" },
          },
        },
      ],
    },
  ];
  const out = await callOpenRouter(cfg, messages, cfg.fileModel);
  return { fields: sanitizeFields(out), model: cfg.fileModel, mode: "file" };
}
