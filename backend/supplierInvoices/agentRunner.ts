import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseInvoiceAgentReply } from "./agentReply.ts";

export async function reviewInvoice(task: { rules: string[]; verifiedLineCount?: number }, sessionKey: string, question: boolean, run = runInvoiceAgent) {
  const retry = { ...task, rules: [...task.rules, "La respuesta anterior no cumplió el contrato de cabecera, líneas y confianza. Devuelve solo el JSON compacto del esquema solicitado: reply breve, confidence numérico, proposal.fields, proposal.lines con TODAS las líneas del PDF y unresolved breve. No repitas explicaciones ni elimines líneas para abreviar. No hagas ninguna escritura."] };
  const raw = await run(task, sessionKey);
  let parsed: ReturnType<typeof parseInvoiceAgentReply>;
  try { parsed = parseInvoiceAgentReply(raw); }
  catch (error) {
    if (question) throw error;
    return parseInvoiceAgentReply(await run(retry, sessionKey));
  }
  if (!question && (!parsed.proposal?.fields || !Array.isArray(parsed.proposal?.lines) || (!parsed.proposal.lines.length && !task.verifiedLineCount) || parsed.confidence == null)) {
    parsed = parseInvoiceAgentReply(await run(retry, sessionKey));
  }
  return parsed;
}

// Full PDF/context can exceed the OS single-argument limit. The supported CLI
// file transport preserves all evidence without putting the document in argv.
export async function runInvoiceAgent(task: unknown, sessionKey: string, start = spawn): Promise<string> {
  const message = JSON.stringify(task);
  if (Buffer.byteLength(message, "utf8") > 4 * 1024 * 1024) throw new Error("El contexto completo supera el límite de 4 MiB del revisor; requiere revisión del documento sin recortar evidencia.");
  const dir = mkdtempSync(join(tmpdir(), "invoice-review-"));
  try {
    const path = join(dir, "task.json");
    writeFileSync(path, message, { mode: 0o600 });
    return await new Promise<string>((resolve, reject) => {
      const child = start("openclaw", ["agent", "--agent", "facturas", "--session-key", sessionKey, "--json", "--timeout", "300", "--message-file", path], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout!.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error((stderr || `Facturas finalizó con código ${code}`).slice(0, 500))));
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
