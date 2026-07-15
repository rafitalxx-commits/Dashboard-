import type {
  AmazonNotificationType,
  AmazonOperationalQueue,
  AmazonConversationPriority,
  AmazonAttachmentMetadata,
  ParsedAmazonEmail,
} from "./amazonMessagesTypes";

const orderIdPattern = /\b\d{3}-\d{7}-\d{7}\b/;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const asinPattern = /\bB0[A-Z0-9]{8}\b/i;
const skuPattern = /\b(?:SKU|Sku|sku)\s*:?\s*([A-Z0-9_-]{2,32})\b/;
const amountPattern = /(?:de|of)?\s*([0-9]+(?:[,.][0-9]{2})?)\s*(?:€|EUR|&nbsp;€)/i;
const notificationTypePattern = /\b[A-Z_]+(?:_[A-Z_]+)*\b/;
const marketplacePattern =
  /\b(?:Amazon\s*)?(ES|FR|DE|IT|NL|BE|UK|SE|PL)\b/i;
const marketplaceIds: Record<string, string> = {
  A1PA6795UKMFR9: "Amazon DE",
  APJ6JRA9NG5V4: "Amazon IT",
};
const maxAttachmentSizeBytes = 10 * 1024 * 1024;
const dangerousExtensions = new Set([
  "bat",
  "cmd",
  "com",
  "exe",
  "hta",
  "html",
  "js",
  "msi",
  "ps1",
  "scr",
  "sh",
  "vbs",
]);
const mimeByExtension: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  heic: "image/heic",
  webp: "image/webp",
};

export function parseAmazonEmail(rawEmail: string, fallbackUid: string) {
  const { headers, body } = splitHeadersAndBody(rawEmail);
  const subject = headers.subject ?? "Sin asunto";
  const from = headers.from ?? "Amazon Buyer";
  const to = headers.to ?? "TodoElectrico";
  const receivedAt = normalizeDate(headers.date);
  const cleanBody = cleanEmailBody(decodeQuotedPrintable(body));
  const marketplaceId = headers["x-marketplace-id"];
  const notificationType = normalizeNotificationType(
    headers["x-space-notification-type"],
  );
  const amazonOrderId =
    firstMatch(subject, orderIdPattern) ?? firstMatch(cleanBody, orderIdPattern);
  const buyerAlias =
    firstMatch(from, emailPattern) ?? firstMatch(cleanBody, emailPattern);
  const marketplace =
    marketplaceFromId(marketplaceId) ??
    normalizeMarketplace(headers["x-amazon-marketplace"] ?? "") ??
    normalizeMarketplace(firstMatch(subject, marketplacePattern) ?? "") ??
    normalizeMarketplace(firstMatch(cleanBody, marketplacePattern) ?? "");
  const language = inferLanguage(subject, cleanBody, marketplace);
  const asin = firstMatch(cleanBody, asinPattern)?.toUpperCase();
  const sku = firstCapture(cleanBody, skuPattern);
  const quantity = extractQuantity(cleanBody, notificationType);
  const amount = extractAmount(cleanBody, notificationType);
  const currency = amount ? "EUR" : undefined;
  const reason = extractReason(cleanBody);
  const operationalStatus = extractOperationalStatus(cleanBody);
  const customerComment = extractCustomerComment(cleanBody);
  const isInternationalReturnAddressRisk = detectInternationalReturnAddressRisk(
    cleanBody,
  );
  const { operationalQueue, priority, recommendedAction } =
    classifyOperationally({
      notificationType,
      subject,
      cleanBody,
      isInternationalReturnAddressRisk,
    });
  const messageId =
    headers["message-id"] ?? `manual-${fallbackUid}-${stableHash(rawEmail)}`;
  const attachments = extractAttachments({
    headers,
    cleanBody,
    messageId,
    receivedAt,
  });
  const attachmentNames = attachments.map((attachment) => attachment.originalName);
  const normalizedHash = stableHash(
    [subject, cleanBody, buyerAlias ?? "", amazonOrderId ?? "", notificationType]
      .join("\n")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim(),
  );

  return {
    uid: headers["x-dashboard-demo-uid"] ?? fallbackUid,
    messageId,
    subject,
    bodyText: body.trim(),
    cleanBody,
    from,
    to,
    receivedAt,
    headers,
    amazonOrderId,
    buyerAlias,
    marketplace,
    marketplaceId,
    notificationType,
    language,
    sku,
    asin,
    quantity,
    amount,
    currency,
    reason,
    operationalStatus,
    customerComment,
    recommendedAction,
    operationalQueue,
    priority,
    isInternationalReturnAddressRisk,
    attachmentNames,
    attachments,
    normalizedHash,
  } satisfies ParsedAmazonEmail;
}

export function deduplicateParsedEmails(emails: ParsedAmazonEmail[]) {
  const seenMessageIds = new Set<string>();
  const seenUids = new Set<string>();
  const seenHashes = new Set<string>();
  const unique: ParsedAmazonEmail[] = [];
  const duplicates: Array<{
    uid: string;
    messageId: string;
    reason: "message-id" | "uid" | "body-hash";
  }> = [];

  for (const email of emails) {
    if (seenMessageIds.has(email.messageId)) {
      duplicates.push({
        uid: email.uid,
        messageId: email.messageId,
        reason: "message-id",
      });
      continue;
    }
    if (seenUids.has(email.uid)) {
      duplicates.push({ uid: email.uid, messageId: email.messageId, reason: "uid" });
      continue;
    }
    if (seenHashes.has(email.normalizedHash)) {
      duplicates.push({
        uid: email.uid,
        messageId: email.messageId,
        reason: "body-hash",
      });
      continue;
    }
    seenMessageIds.add(email.messageId);
    seenUids.add(email.uid);
    seenHashes.add(email.normalizedHash);
    unique.push(email);
  }

  return { unique, duplicates };
}

function splitHeadersAndBody(rawEmail: string) {
  const [headerBlock, ...bodyParts] = rawEmail.replace(/\r\n/g, "\n").split("\n\n");
  const headers: Record<string, string> = {};
  let currentHeader = "";

  for (const line of headerBlock.split("\n")) {
    if (/^\s/.test(line) && currentHeader) {
      headers[currentHeader] = `${headers[currentHeader]} ${line.trim()}`;
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    currentHeader = line.slice(0, separator).trim().toLowerCase();
    headers[currentHeader] = line.slice(separator + 1).trim();
  }

  return { headers, body: bodyParts.join("\n\n") };
}

function cleanEmailBody(body: string) {
  return body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|tr|table|div|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/^-{2,}\s*Original Message\s*-{2,}[\s\S]*$/gim, "")
    .replace(/^On .+ wrote:[\s\S]*$/gim, "")
    .replace(/^>.*$/gm, "")
    .replace(/\[cid:[^\]]+\]/gi, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractAttachments({
  headers,
  cleanBody,
  messageId,
  receivedAt,
}: {
  headers: Record<string, string>;
  cleanBody: string;
  messageId: string;
  receivedAt: string;
}) {
  const declared = headers["x-attachments"]?.split(",") ?? [];
  const fromBody = Array.from(
    cleanBody.matchAll(/attachment:\s*([^\n]+)/gi),
    (match) => match[1],
  );
  const uniqueNames = new Set<string>();

  return [...declared, ...fromBody]
    .map((item) => item.trim())
    .filter(Boolean)
    .map((name) => buildAttachmentMetadata(name, messageId, receivedAt))
    .filter((attachment) => {
      const key = attachment.sanitizedName.toLowerCase();
      if (uniqueNames.has(key)) return false;
      uniqueNames.add(key);
      return true;
    });
}

function firstMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[0];
}

function firstCapture(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1];
}

function normalizeDate(value?: string) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeMarketplace(value: string) {
  const match = value.match(marketplacePattern);
  return match ? `Amazon ${match[1].toUpperCase()}` : undefined;
}

export function buildAttachmentMetadata(
  rawName: string,
  messageId: string,
  receivedAt: string,
  sizeBytes?: number,
): AmazonAttachmentMetadata {
  const parsed = parseAttachmentDescriptor(rawName);
  const originalName = parsed.name;
  const sanitizedName = sanitizeAttachmentName(originalName);
  const extension = extensionFromName(sanitizedName);
  const mimeType = parsed.mimeType ?? mimeByExtension[extension] ?? "application/octet-stream";
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";
  const isText = mimeType.startsWith("text/");
  const blockedReason = blockedAttachmentReason(extension, parsed.sizeBytes ?? sizeBytes);
  const allowed = !blockedReason;
  const kind = !allowed
    ? "blocked"
    : isImage
      ? "image"
      : isPdf
        ? "pdf"
        : isText
          ? "text"
          : "other";

  return {
    id: `att-${stableHash(`${messageId}:${sanitizedName}`)}`,
    messageId,
    originalName,
    sanitizedName,
    mimeType,
    extension,
    sizeBytes: parsed.sizeBytes ?? sizeBytes,
    hash: stableHash(`${messageId}:${sanitizedName}:${parsed.sizeBytes ?? sizeBytes ?? 0}`),
    receivedAt,
    origin: "amazon_email_relay",
    downloadable: allowed,
    previewable: allowed && (isImage || isPdf || isText),
    isImage: allowed && isImage,
    isPdf: allowed && isPdf,
    kind,
    allowed,
    blockedReason,
    visualAnalysisReady: allowed && isImage,
    visualAnalysisHints: allowed && isImage
      ? [
          "broken_product",
          "wrong_product",
          "damaged_packaging",
          "visible_label",
          "visible_serial_number",
        ]
      : [],
  };
}

function parseAttachmentDescriptor(value: string) {
  const parts = value.split("|").map((part) => part.trim()).filter(Boolean);
  const name = parts[0] ?? "attachment";
  const mimeType = parts.find((part) => part.includes("/"));
  const sizePart = parts.find((part) => /^\d+$/.test(part));

  return {
    name,
    mimeType,
    sizeBytes: sizePart ? Number(sizePart) : undefined,
  };
}

function sanitizeAttachmentName(value: string) {
  const baseName = value
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return (baseName || "attachment").slice(0, 120);
}

function extensionFromName(value: string) {
  const extension = value.split(".").pop()?.toLowerCase() ?? "";
  return extension === value.toLowerCase() ? "" : extension;
}

function blockedAttachmentReason(extension: string, sizeBytes?: number) {
  if (dangerousExtensions.has(extension)) return "Extension peligrosa bloqueada";
  if (sizeBytes && sizeBytes > maxAttachmentSizeBytes) return "Tamano maximo superado";
  return undefined;
}

function marketplaceFromId(value?: string) {
  if (!value) return undefined;
  return marketplaceIds[value] ?? value;
}

function normalizeNotificationType(value?: string): AmazonNotificationType {
  const token = value?.match(notificationTypePattern)?.[0];
  if (
    token === "BBC_MESSAGE_SENT_TO_MERCHANT" ||
    token === "BRC_SELLER_NOTIFICATION" ||
    token === "RETURN_REQUEST" ||
    token === "A_Z_CLAIM_RESPONDENT_CLOSE"
  ) {
    return token;
  }
  return "UNKNOWN";
}

function inferLanguage(subject: string, body: string, marketplace?: string) {
  const value = `${subject} ${body}`.toLowerCase();
  if (containsAny(value, ["guten tag", "sendungsnummer", "paket", "abholstation"])) {
    return "de";
  }
  if (containsAny(value, ["bonjour", "commande", "merci"])) return "fr";
  if (containsAny(value, ["sbagliato", "acquisto", "serviva"])) return "it";
  if (containsAny(value, ["hola", "pedido", "devolucion", "reclamacion"])) return "es";
  if (marketplace?.endsWith("DE")) return "de";
  if (marketplace?.endsWith("IT")) return "it";
  return undefined;
}

function extractQuantity(body: string, notificationType: AmazonNotificationType) {
  const explicit = body.match(/(?:Cantidad de la devolucion|Cantidad de la devolución|Quantity)\s*:?\s+(\d+)/i);
  if (explicit) return Number(explicit[1]);
  if (notificationType === "BBC_MESSAGE_SENT_TO_MERCHANT") {
    const lineQuantity = body.match(/#\s*\d{3}-\d{7}-\d{7}:\s*(\d+)\s*\//);
    if (lineQuantity) return Number(lineQuantity[1]);
  }
  return undefined;
}

function extractAmount(body: string, notificationType: AmazonNotificationType) {
  if (notificationType !== "A_Z_CLAIM_RESPONDENT_CLOSE") return undefined;
  const match = body.match(amountPattern);
  if (!match) return undefined;
  return Number(match[1].replace(",", "."));
}

function extractReason(body: string) {
  return (
    firstCapture(body, /Motivo de la devolucion\s*:?\s+([^\n]+)/i) ??
    firstCapture(body, /Motivo de la devolución\s*:?\s+([^\n]+)/i) ??
    firstCapture(body, /Reason\s*:?\s+([^\n]+)/i)
  )?.trim();
}

function extractOperationalStatus(body: string) {
  return (
    firstCapture(body, /Autorizacion\s*:?\s+([^\n]+)/i) ??
    firstCapture(body, /Autorización\s*:?\s+([^\n]+)/i) ??
    firstCapture(body, /Comprobacion de la politica de devoluciones\s*:?\s+([^\n]+)/i) ??
    firstCapture(body, /Comprobación de la política de devoluciones\s*:?\s+([^\n]+)/i)
  )?.trim();
}

function extractCustomerComment(body: string) {
  return (
    firstCapture(body, /Comentario del cliente\s*:?\s+([^\n]+)/i) ??
    firstCapture(body, /Message:\s*([\s\S]*?)(?:Finalizar mensaje|Resolver caso|$)/i)
  )?.trim();
}

function detectInternationalReturnAddressRisk(body: string) {
  const value = body.toLowerCase();
  return containsAny(value, [
    "direccion de devolucion internacional",
    "dirección de devolución internacional",
    "direccion internacional",
    "dirección internacional",
    "local return address",
    "international return",
    "politica local",
    "política local",
  ]);
}

function classifyOperationally({
  notificationType,
  subject,
  cleanBody,
  isInternationalReturnAddressRisk,
}: {
  notificationType: AmazonNotificationType;
  subject: string;
  cleanBody: string;
  isInternationalReturnAddressRisk: boolean;
}): {
  operationalQueue: AmazonOperationalQueue;
  priority: AmazonConversationPriority;
  recommendedAction: string;
} {
  if (notificationType === "BRC_SELLER_NOTIFICATION") {
    return {
      operationalQueue: "cancellations",
      priority: "high",
      recommendedAction: "Comprobar si el pedido ya esta enviado antes de cancelar.",
    };
  }
  if (notificationType === "RETURN_REQUEST") {
    return {
      operationalQueue: "returns",
      priority: "high",
      recommendedAction: "Revisar motivo, SKU, cantidad y estado en Amazon/Odoo.",
    };
  }
  if (notificationType === "A_Z_CLAIM_RESPONDENT_CLOSE") {
    return {
      operationalQueue: "critical",
      priority: "urgent",
      recommendedAction: isInternationalReturnAddressRisk
        ? "Revisar de inmediato, preparar apelacion si procede y corregir direccion local de devolucion."
        : "Revisar de inmediato, preparar apelacion si procede y documentar causa raiz.",
    };
  }
  if (notificationType === "BBC_MESSAGE_SENT_TO_MERCHANT") {
    const value = `${subject} ${cleanBody}`.toLowerCase();
    if (containsAny(value, ["paket nicht", "nicht erhalten", "abholstation", "sendungsnummer", "nachlieferung", "versand", "tracking"])) {
      return {
        operationalQueue: "logistics",
        priority: "high",
        recommendedAction: "Comprobar tracking, entrega y siguiente accion logistica.",
      };
    }
    if (containsAny(value, ["rechnung", "factura", "invoice"])) {
      return {
        operationalQueue: "invoices",
        priority: "high",
        recommendedAction: "Localizar factura y validar adjunto antes de responder.",
      };
    }
    return {
      operationalQueue: "conversations",
      priority: "normal",
      recommendedAction: "Responder desde Seller Central tras revisar contexto del pedido.",
    };
  }
  return {
    operationalQueue: "unclassified",
    priority: "normal",
    recommendedAction: "Clasificar manualmente antes de actuar.",
  };
}

function containsAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function decodeQuotedPrintable(value: string) {
  const bytes: number[] = [];
  const compact = value.replace(/=\r?\n/g, "");

  for (let index = 0; index < compact.length; index += 1) {
    if (
      compact[index] === "=" &&
      /[0-9A-Fa-f]{2}/.test(compact.slice(index + 1, index + 3))
    ) {
      bytes.push(Number.parseInt(compact.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    bytes.push(compact.charCodeAt(index));
  }

  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
