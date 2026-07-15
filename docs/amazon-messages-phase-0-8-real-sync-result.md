# Amazon Messages Phase 0.8 Real Sync Result

Date: 2026-06-20

Mode: controlled real Gmail sync, read-only.

## Scope

Executed the first real Gmail synchronization for Amazon Messages with these limits:

- No emails sent.
- No buyer replies.
- No SP-API Messaging connection.
- No Odoo writes.
- No Sendcloud writes.
- No production store mutation.
- Initial import capped at 20 Gmail messages.

The test Vite server was started on port `5176` with isolated state:

- URL: `http://212.47.76.180:5176/#/amazon-messages`
- Data store: `/tmp/amazon-phase-0-8-data/amazon-messages-store.json`
- Auth store: `/tmp/amazon-phase-0-8-auth.json`

Secrets were injected only into the temporary process environment and were not written to this report.

## Configuration Verified

- Gmail OAuth account: `juanitoopenclaw@gmail.com`
- Gmail label: `AmazonSeller`
- Gmail label ID: `Label_5492142662127703098`
- Sync limit: `AMAZON_MESSAGES_GMAIL_MAX_MESSAGES=20`
- Endpoint executed: `POST /api/amazon-messages/gmail/sync`

The Gmail label exists and was readable with the authorized OAuth token.

## Sync Result

```json
{
  "ok": true,
  "mode": "gmail_readonly",
  "account": "juanitoopenclaw@gmail.com",
  "labelName": "AmazonSeller",
  "labelId": "Label_5492142662127703098",
  "scanned": 1,
  "imported": 1,
  "updated": 0,
  "duplicates": 0,
  "errors": 0,
  "processMs": 714
}
```

Detailed counters:

- Correos leidos: 1
- Correos importados: 1
- Duplicados ignorados: 0
- Errores: 0
- Conversaciones creadas: 1
- Conversaciones actualizadas: 0
- Adjuntos detectados: 0
- Clasificacion automatica: `other`, priority `normal`, source `parser`, confidence `0.9`
- Cola asignada: no `queue` field persisted for this imported conversation
- Usuario asignado: `Soporte`

Imported conversation:

```json
{
  "conversationId": "amz-gmail-403-9628163-5791508",
  "amazonOrderId": "403-9628163-5791508",
  "marketplace": "A1RKKUPIHCS9HS",
  "language": "es",
  "status": "open",
  "priority": "normal",
  "category": "other",
  "messageCount": 1
}
```

Audit events created:

- `gmail_message_read`
- `gmail_conversation_created`

## Visual Review

Chromium headless was installed locally because the OpenClaw browser profile had no Chrome/Chromium available.

Captured screenshots:

- `/tmp/amazon-phase-0-8-ui.png`
- `/tmp/amazon-phase-0-8-ui-supervisor.png`

Visual result at `http://212.47.76.180:5176/#/amazon-messages`:

- The Amazon Messages view loads after login.
- The `Supervisor` tab shows `GMAIL READONLY`.
- The panel displays:
  - Cuenta: `juanitoopenclaw@gmail.com`
  - Etiqueta: `AmazonSeller`
  - Importados: `1`
  - Duplicados: `0`
  - Errores: `0`
  - Pendientes: `0`
  - Proceso medio: `9 ms`

Important UI finding: the visible inbox conversation list still comes from `buildAmazonDemoConversations(...)` in `AmazonMessagesView.tsx`, not from `GET /api/amazon-messages/conversations`. The real Gmail-imported conversation is present in the backend store/API, but it is not shown in the main inbox list yet.

## Conclusion

Phase 0.8 real Gmail readonly sync is activated and verified for the controlled local instance.

The backend import path works with real Gmail data from `AmazonSeller`: OAuth, label lookup, message read, parser classification, persistence, dedup counters, and audit logging all completed without errors.

Next required implementation step before broader validation: wire `AmazonMessagesView.tsx` to consume backend conversations instead of demo fixtures, or add an explicit real-data mode for the inbox.
