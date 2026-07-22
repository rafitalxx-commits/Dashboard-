import { createHash, createHmac } from "node:crypto";
import type { AmazonShipmentConfirmationDraft } from "./schema.ts";

type AmazonSpApiConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsRegion: string;
  marketplaceId: string;
  endpoint: string;
  dryRun: boolean;
  useAwsSigV4: boolean;
};

type LwaToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedToken: LwaToken | null = null;

export function getAmazonSpApiConfig(env: Record<string, string>): AmazonSpApiConfig {
  const region = env.AWS_REGION || "eu-west-1";
  return {
    clientId: env.AMAZON_CLIENT_ID || "",
    clientSecret: env.AMAZON_CLIENT_SECRET || "",
    refreshToken: env.AMAZON_REFRESH_TOKEN || "",
    awsAccessKeyId: env.AWS_ACCESS_KEY_ID || "",
    awsSecretAccessKey: env.AWS_SECRET_ACCESS_KEY || "",
    awsRegion: region,
    marketplaceId: env.MARKETPLACE_ID || "",
    endpoint: (env.AMAZON_SP_API_ENDPOINT || defaultEndpoint(region)).replace(/\/+$/, ""),
    dryRun: !isFalse(env.DRY_RUN) && !isFalse(env.AMAZON_SP_API_DRY_RUN),
    useAwsSigV4: env.AMAZON_SP_API_USE_AWS_SIGV4 === "true",
  };
}

export function createAmazonSpApiClient(env: Record<string, string>) {
  const config = getAmazonSpApiConfig(env);

  async function confirmShipment(draft: AmazonShipmentConfirmationDraft, options: { dryRun?: boolean } = {}) {
    const request = buildConfirmShipmentRequest(config, draft);
    const dryRun = options.dryRun ?? config.dryRun;
    if (dryRun) {
      return {
        dryRun: true,
        request,
        response: {
          status: "dry-run",
          message: "Simulacion: no se ha transmitido nada a Amazon",
        },
      };
    }
    requireLiveConfig(config);
    const token = await getLwaAccessToken(config);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-amz-access-token": token,
    };
    if (config.useAwsSigV4) {
      Object.assign(headers, signAwsRequest(config, "POST", request.path, request.body));
    }
    const response = await fetch(`${config.endpoint}${request.path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(request.body),
    });
    const rawBody = await response.text();
    const parsedBody = rawBody ? safeJson(rawBody) : null;
    const result = {
      dryRun: false,
      request,
      response: {
        ok: response.ok,
        status: response.status,
        rateLimit: response.headers.get("x-amzn-RateLimit-Limit") || undefined,
        requestId: response.headers.get("x-amzn-RequestId") || undefined,
        body: parsedBody,
      },
    };
    if (!response.ok) {
      throw Object.assign(new Error(extractAmazonError(parsedBody, response.status)), { result });
    }
    return result;
  }

  return { confirmShipment, config };
}

export function buildConfirmShipmentRequest(
  config: Pick<AmazonSpApiConfig, "endpoint" | "marketplaceId">,
  draft: AmazonShipmentConfirmationDraft,
) {
  if (!draft.amazonOrderId || !/^\d{3}-\d{7}-\d{7}$/.test(draft.amazonOrderId)) {
    throw new Error("Pedido Amazon no valido para confirmShipment");
  }
  if (!draft.tracking.trim()) throw new Error("No hay tracking para confirmar Amazon");
  if (!draft.orderItems.length) throw new Error("Amazon requiere lineas de pedido con orderItemId");
  const body = {
    marketplaceId: draft.marketplaceId || config.marketplaceId,
    packageDetail: {
      packageReferenceId: draft.packageReferenceId,
      carrierCode: normalizeCarrierCode(draft.carrierCode || draft.carrier),
      carrierName: draft.carrier,
      shippingMethod: draft.shippingMethod || draft.carrier,
      trackingNumber: draft.tracking,
      shipDate: draft.shipmentDate,
      orderItems: draft.orderItems.map((item) => ({
        orderItemId: item.orderItemId,
        quantity: item.quantity,
      })),
    },
  };
  if (!body.marketplaceId) throw new Error("Falta MARKETPLACE_ID para Amazon SP-API");
  return {
    method: "POST",
    endpoint: config.endpoint,
    path: `/orders/v0/orders/${encodeURIComponent(draft.amazonOrderId)}/shipmentConfirmation`,
    body,
  };
}

function normalizeCarrierCode(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized.includes("FEDEX") || normalized.includes("GLOBAL EXPRESS")) return "FedEx";
  if (normalized.includes("UPS")) return "UPS";
  if (normalized.includes("DHL")) return "DHL";
  if (normalized.includes("GLS")) return "GLS";
  if (normalized.includes("SEUR")) return "SEUR";
  if (normalized.includes("CTT")) return "CTT";
  if (normalized.includes("CORREOS")) return "Correos";
  return value.trim();
}

async function getLwaAccessToken(config: AmazonSpApiConfig) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.accessToken;
  const response = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  const payload = await response.json() as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Amazon LWA no ha devuelto access token");
  }
  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

function signAwsRequest(config: AmazonSpApiConfig, method: string, path: string, body: unknown) {
  if (!config.awsAccessKeyId || !config.awsSecretAccessKey) return {};
  const service = "execute-api";
  const host = new URL(config.endpoint).host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(JSON.stringify(body));
  const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-date";
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${config.awsRegion}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(config.awsSecretAccessKey, dateStamp, config.awsRegion, service), stringToSign, "hex");
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${config.awsAccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-date": amzDate,
  };
}

function signingKey(secret: string, dateStamp: string, region: string, service: string) {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function hmac(key: string | Buffer, value: string, encoding?: "hex") {
  return createHmac("sha256", key).update(value).digest(encoding);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function defaultEndpoint(region: string) {
  if (region.startsWith("us-")) return "https://sellingpartnerapi-na.amazon.com";
  if (region.startsWith("ap-")) return "https://sellingpartnerapi-fe.amazon.com";
  return "https://sellingpartnerapi-eu.amazon.com";
}

function isFalse(value?: string) {
  return String(value || "").toLowerCase() === "false";
}

function requireLiveConfig(config: AmazonSpApiConfig) {
  const missing = [
    ["AMAZON_CLIENT_ID", config.clientId],
    ["AMAZON_CLIENT_SECRET", config.clientSecret],
    ["AMAZON_REFRESH_TOKEN", config.refreshToken],
    ["MARKETPLACE_ID", config.marketplaceId],
  ].filter(([, value]) => !value);
  if (missing.length) throw new Error(`Faltan variables Amazon SP-API: ${missing.map(([key]) => key).join(", ")}`);
}

function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractAmazonError(body: unknown, status: number) {
  if (body && typeof body === "object") {
    const errors = (body as { errors?: Array<{ message?: string; code?: string }> }).errors;
    if (errors?.length) return errors.map((error) => `${error.code || "Amazon"}: ${error.message || "sin detalle"}`).join("; ");
  }
  return `Amazon SP-API ha respondido HTTP ${status}`;
}
