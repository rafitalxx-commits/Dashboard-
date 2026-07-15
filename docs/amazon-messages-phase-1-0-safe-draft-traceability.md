# Amazon Messages Phase 1.0 Safe Draft Traceability

Date: 2026-06-21

Mode: safe/read-only UI workflow.

## Objective

Improve the Gmail readonly Amazon Messages flow so a real imported conversation can be inspected in detail, traced clearly to Gmail, and used to generate an internal draft without sending anything to the buyer.

Absolute restrictions respected:

- No emails sent.
- No buyer replies.
- No SP-API Messaging connection.
- No Odoo writes.
- No Sendcloud writes.
- No data deletion.
- Safe mode maintained.
- Drafts are internal UI proposals only.

## Files Modified

- `src/modules/amazonMessages/AmazonMessagesView.tsx`
- `src/modules/amazonMessages/amazonMessages.css`

## Detail View

The real Gmail-imported conversation detail now shows:

- Amazon order: `403-9628163-5791508`
- Sender: `Amparo`
- Subject: `Mensaje Amazon pedido 403-9628163-5791508`
- Message body from the Gmail readonly import
- Message date
- Origin: `Gmail readonly`
- Source label: `AmazonSeller`
- Classification: `other`
- Priority: `normal`
- Assigned user: `Soporte`
- Internal event history

## Traceability Panel

Added `Trazabilidad Gmail readonly` panel with:

- Imported from Gmail readonly
- Source label `AmazonSeller`
- Import date
- Parser used: `amazonEmailParser / backend parser`
- Current status
- Attachment presence
- Duplicate status
- Sender
- Subject
- Message date
- Internal draft status

## Internal Draft

Added a `Generar borrador` button.

The generated draft:

- Is stored internally in browser `localStorage`.
- Is not sent.
- Does not call SP-API.
- Does not reply to the buyer.
- Does not touch Odoo or Sendcloud.
- Is marked as `BORRADOR INTERNO`.
- Uses a conservative initial template:
  - greeting
  - receipt confirmation
  - pending internal review
  - TodoElectrico sign-off

Added visual states:

- `SIN BORRADOR`
- `BORRADOR INTERNO`
- `LISTO PARA REVISAR`

Editing the generated textarea changes the state to `LISTO PARA REVISAR`.

## Audit

Generating a draft adds a visible internal audit event:

`Borrador interno generado desde Gmail readonly. Sin envio externo, sin SP-API y sin respuesta al comprador.`

The audit event includes:

- Actor: `Rafa`
- Timestamp
- Conversation association
- Gmail readonly source
- Explicit no-send/no-external-action wording

## Supervisor Panel

Supervisor keeps Gmail readonly metrics and now shows the safe-mode source explicitly:

- Importados: `1`
- Duplicados: `0`
- Errores: `0`
- Fuente: `Gmail readonly`
- Modo seguro: `Sin envio externo`

## Verification

Build:

```bash
npm run build
```

Result:

- Build completed successfully.
- 1641 modules transformed.

Headless UI verification on `http://127.0.0.1:5176/#/amazon-messages`:

```json
{
  "hasRealOrder": true,
  "hasTraceability": true,
  "hasOrigin": true,
  "hasAmazonSeller": true,
  "hasDraftState": true,
  "draftValueOk": true,
  "draftPersistsAfterReload": true,
  "hasAudit": true,
  "hasNoExternalSend": true,
  "supervisorHasImported": true,
  "supervisorHasSource": true,
  "supervisorHasSafeMode": true
}
```

Additional edit-state verification:

```json
{
  "hasReadyState": true,
  "sample": ["LISTO PARA REVISAR", "BORRADOR INTERNO"]
}
```

Captured files:

- `/tmp/amazon-phase-1-0-ui-draft-final.png`
- `/tmp/amazon-phase-1-0-ui-draft-final-text.txt`
- `/tmp/amazon-phase-1-0-ui-supervisor-final.png`
- `/tmp/amazon-phase-1-0-ui-supervisor-final-text.txt`

## Result

Phase 1.0 is complete for the controlled local instance:

- The real Gmail conversation appears in the main inbox.
- The detail view exposes order, sender, subject, body, date, classification, priority, assignment, and history.
- Gmail readonly traceability is visible.
- An internal draft can be generated and persisted locally.
- The draft is never sent.
- Supervisor remains visible with Gmail readonly metrics and safe-mode status.
- No external system was modified.
