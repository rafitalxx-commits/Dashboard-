# Amazon Messages Phase 0.9 Real Inbox Render

Date: 2026-06-21

Mode: safe/read-only UI activation.

## Objective

Make the main Amazon Messages inbox render real backend/API conversations instead of using `buildAmazonDemoConversations(...)` as the default source.

Safety limits respected:

- No emails sent.
- No buyer replies.
- No SP-API Messaging connection.
- No Odoo writes.
- No Sendcloud writes.
- No data deletion.
- Read-only mode maintained.

## Changes

Files modified:

- `src/modules/amazonMessages/AmazonMessagesView.tsx`
- `src/modules/amazonMessages/amazonMessages.css`

Implementation summary:

- Added real conversation loading from `GET /api/amazon-messages/conversations`.
- Added per-conversation detail loading from `GET /api/amazon-messages/conversations/{id}`.
- Added an adapter from backend records to the existing frontend `AmazonConversation` model.
- Kept `buildAmazonDemoConversations(...)` only as fallback when the API fails or returns no imported real conversations.
- Filtered known backend seed fixture records with IDs starting `amz-backend-conv-` so they do not appear as the default real inbox.
- Added visual source indicator:
  - `REAL API`
  - `DEMO FALLBACK`
- Kept the Supervisor Gmail readonly panel and its metrics.

## Real API Endpoint Confirmed

Primary endpoint:

- `GET /api/amazon-messages/conversations`

Detail endpoint:

- `GET /api/amazon-messages/conversations/{conversationId}`

Current API response in the controlled `5176` instance includes 3 records total:

- 2 known backend seed fixtures: filtered from the main real inbox.
- 1 Gmail-imported conversation: shown in the main inbox.

Gmail-imported order shown:

- `403-9628163-5791508`

## Verification

Build:

```bash
npm run build
```

Result:

- Build completed successfully.
- 1641 modules transformed.

API verification:

```json
{
  "apiCount": 3,
  "gmailImported": ["403-9628163-5791508"]
}
```

Headless visual verification on `http://127.0.0.1:5176/#/amazon-messages`:

```json
{
  "hasRealApi": true,
  "hasImportedOrder": true,
  "hasSeedFixture": false,
  "hasDemoFallback": false,
  "hasOneConversationMetric": true,
  "supervisorHasGmail": true,
  "supervisorHasImported": true
}
```

Captured files:

- `/tmp/amazon-phase-0-9-ui-inbox-final.png`
- `/tmp/amazon-phase-0-9-ui-inbox-final-text.txt`
- `/tmp/amazon-phase-0-9-ui-supervisor-final.png`
- `/tmp/amazon-phase-0-9-ui-supervisor-final-text.txt`

Visible inbox result:

- Badge: `REAL API`
- Conversation count: `1`
- Main list includes buyer `Amparo`
- Main list includes `Mensaje Amazon pedido 403-9628163-5791508`
- Demo fallback is not shown
- Known seed fixtures `301-0000001-0000001` and `305-0000005-0000005` are not shown in the inbox

Visible Supervisor result:

- `GMAIL READONLY` panel remains visible
- Cuenta: `juanitoopenclaw@gmail.com`
- Etiqueta: `AmazonSeller`
- Importados: `1`
- Duplicados: `0`
- Errores: `0`

## Notes

The backend/API still contains seed fixture records in the isolated Phase 0.8 data store. Phase 0.9 does not delete or mutate them. The UI now excludes those known seed IDs from the real inbox path and only uses demo data as fallback.

The imported Gmail message is rendered with a safe read-only detail view. The existing send guard remains visible and sending is still disabled.

## Result

Phase 0.9 is complete for the controlled local instance:

- The main inbox no longer defaults to frontend fixtures.
- The imported Gmail conversation appears in the main list.
- The UI clearly indicates `REAL API`.
- Demo fixtures remain available only as fallback.
- No external systems were modified.
