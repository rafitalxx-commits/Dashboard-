type AgentReply = { reply: string; proposal: Record<string, unknown> | null; unresolved: string[]; confidence?: number };

/** OpenClaw CLI may wrap the agent's JSON in one or more result.payloads[].text layers. */
export function parseInvoiceAgentReply(raw: string): AgentReply {
  const queue: unknown[] = [raw];
  let visited = 0;
  let lastParseError = "";
  let longestText = 0;
  while (queue.length && visited++ < 16) {
    const value = queue.shift();
    if (typeof value === "string") {
      longestText = Math.max(longestText, value.length);
      const candidate = value.trim().match(/^```(?:json)?\s*([\s\S]*?)```$/i)?.[1] ?? value.trim();
      try { queue.push(JSON.parse(candidate)); } catch (error) { lastParseError = error instanceof Error && /end of JSON|Unterminated/i.test(error.message) ? "respuesta incompleta" : "JSON inválido"; }
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, any>;
    if (typeof item.reply === "string" && item.reply.trim()) {
      const confidence = typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? Math.max(0, Math.min(100, Math.round(item.confidence)))
        : undefined;
      return {
        reply: item.reply.trim().slice(0, 1600),
        proposal: item.proposal && typeof item.proposal === "object" ? item.proposal : null,
        unresolved: Array.isArray(item.unresolved) ? item.unresolved.map(String).slice(0, 12) : [],
        ...(confidence != null ? { confidence } : {}),
      };
    }
    if (item.result) queue.push(item.result);
    if (Array.isArray(item.payloads)) for (const payload of item.payloads) if (typeof payload?.text === "string") queue.push(payload.text);
    if (typeof item.text === "string") queue.push(item.text);
  }
  throw new Error(`Raskibot no devolvió JSON estructurado (texto ${longestText} caracteres; ${lastParseError || "sin respuesta"}); no se aplicó al borrador.`);
}

export function isConcatenatedInvoiceNumber(value: unknown): boolean {
  return typeof value === "string" && /\d{1,2}[/-]\d{1,2}[/-]\d{4}/.test(value);
}
