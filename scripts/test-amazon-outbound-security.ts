import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const sourceFiles = [
  "backend/amazonMessages/gmailClient.ts",
  "backend/amazonMessages/routes.ts",
  "backend/amazonMessages/repository.ts",
  "backend/amazonMessages/schema.ts",
  "src/modules/amazonMessages/AmazonMessagesView.tsx",
  "src/modules/amazonMessages/amazonMessagesTypes.ts",
];

const forbiddenEverywhere: Array<[RegExp, string]> = [
  [/users\.messages\.send/i, "Gmail users.messages.send reference"],
  [/\/gmail\/v1\/users\/me\/messages\/send/i, "Gmail messages send API path"],
  [/reply\/send/i, "reply/send route"],
  [/amazon-messages[^"'`]*\/send/i, "Amazon Messages send route"],
  [/gmail\s+send/i, "Gmail Send user-facing text"],
  [/send\s+manual/i, "manual send user-facing text"],
];

const gmailClientForbidden: Array<[RegExp, string]> = [
  [/\b(send|sendDraft|sendMessage|gmailSend|sendGmail)\s*[:=]?\s*(async\s*)?\(/, "Gmail client send method"],
];

const uiForbidden: Array<[RegExp, string]> = [
  [/\bEnviar (email|correo|al comprador)\b/i, "loose real-send UI copy"],
];

for (const file of sourceFiles) {
  const content = readFileSync(join(root, file), "utf8");
  for (const [pattern, reason] of forbiddenEverywhere) {
    assert.doesNotMatch(content, pattern, `${reason} must not appear in ${file}`);
  }
}

const gmailClient = readFileSync(
  join(root, "backend/amazonMessages/gmailClient.ts"),
  "utf8",
);
for (const [pattern, reason] of gmailClientForbidden) {
  assert.doesNotMatch(gmailClient, pattern, `${reason} must not exist`);
}
assert.match(
  gmailClient,
  /createOrUpdateDraft/,
  "Gmail client should expose only create/update draft behavior",
);
assert.match(
  gmailClient,
  /\/gmail\/v1\/users\/me\/drafts\b/,
  "Gmail draft creation must use drafts endpoint, not send endpoint",
);
assert.match(
  gmailClient,
  /createGmailApiFinalDraftSendSource/,
  "final Gmail draft delivery must live in isolated Gmail client service",
);
assert.equal(
  (gmailClient.match(/\/gmail\/v1\/users\/me\/drafts\/send/g) ?? []).length,
  1,
  "Gmail drafts final endpoint must appear exactly once in isolated service",
);
assert.doesNotMatch(
  readFileSync(join(root, "backend/amazonMessages/routes.ts"), "utf8"),
  /\/gmail\/v1\/users\/me\/drafts\/send/i,
  "routes must not reference Gmail drafts final endpoint directly",
);

const routes = readFileSync(join(root, "backend/amazonMessages/routes.ts"), "utf8");
assert.match(routes, /parts\[2\] === "gmail-draft"/, "endpoint must be draft-named");
assert.match(routes, /AMAZON_MESSAGES_OUTBOUND_MODE=disabled/, "disabled mode must block");
assert.match(routes, /outboundMode !== "draft_only" && outboundMode !== "manual_send"/, "draft creation must allow only draft_only and manual_send");
assert.match(routes, /parts\[2\] === "finalize"/, "final send endpoint must be explicit");
assert.match(routes, /outboundMode !== "manual_send"/, "final send must require manual_send");
assert.match(routes, /assertAllowedValidationRecipient/, "real validation must keep recipient allowlist");

const view = readFileSync(
  join(root, "src/modules/amazonMessages/AmazonMessagesView.tsx"),
  "utf8",
);
for (const [pattern, reason] of uiForbidden) {
  assert.doesNotMatch(view, pattern, `${reason} must not appear`);
}
assert.match(
  view,
  /Crear\/actualizar borrador Gmail/,
  "operator button must say Crear/actualizar borrador Gmail",
);
assert.match(view, /Enviar y resolver/, "operator final button must say Enviar y resolver");
assert.match(view, /Traducir al español/, "customer messages must expose Spanish translation");
assert.match(
  view,
  /Traducir al idioma del cliente/,
  "AI draft must expose customer-language translation",
);
assert.match(view, /Historial completo/, "conversation detail must show full history");
assert.match(
  view,
  /amazonMessagesSendFinal/,
  "operator final button must require amazonMessagesSendFinal permission",
);
assert.match(
  view,
  /idempotencyKey/,
  "operator final confirmation must include idempotencyKey",
);
assert.match(
  view,
  /Esta acción enviará el mensaje al cliente, registrará auditoría y marcará la conversación como resuelta/,
  "operator final modal must show irreversible action warning",
);

console.log("Amazon outbound security tests passed.");
