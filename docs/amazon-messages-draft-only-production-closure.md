# Amazon Messages draft_only production closure

Date: 2026-06-28

## Approved production state

- `draft_only` deployed and validated in production.
- `AMAZON_MESSAGES_OUTBOUND_MODE=draft_only`.
- Gmail account: `juanitoopenclaw@gmail.com`.
- Real Gmail draft was created and updated without duplication.
- No Gmail send was enabled.
- `manual_send` remains not implemented.
- No SP-API messaging was enabled.
- Anti-send security test passed.

## Backup

Backup path:

```text
/root/.openclaw/backups/amazon-draft-only-20260628-161852
```

Backup contents:

- source code tarball;
- `/var/www/odoo-v18-dashboard` frontend;
- `.dashboard-data/amazon-messages-store.json`;
- `/etc/odoo-v18-dashboard/amazon-messages-gmail.env`;
- `SHA256SUMS`.

## Production validation

Conversation:

```text
amz-gmail-403-9628163-5791508
```

Order:

```text
403-9628163-5791508
```

Draft validation:

- Gmail draft id: `r7357333767031983347`.
- Subject: `Re: Pedido Amazon 403-9628163-5791508`.
- Recipient: Amazon marketplace relay for the real conversation.
- Created from approved PendingReply.
- Updated using the same Gmail draft id.
- Confirmed in Gmail with label `DRAFT`.
- Search in Gmail Sent for the same recipient and subject returned no sent messages.

Cleanup:

- The production validation draft was deleted after approval.
- Before deletion, it was verified to contain `VALIDACION TECNICA DRAFT_ONLY - NO ENVIAR`.
- The subject/order matched `403-9628163-5791508`.
- The decoded Gmail draft body hash matched the store hash
  `458d772e316ce9ebf2a08206d1e822c7c50b61605a77a23ac21a9c8b1bb2124c`, so there was no evidence of manual modification.
- Post-delete Gmail draft list was empty.

## Tests

Passed after deployment:

```bash
npm run build
npm run test:amazon-outbound-security
npm run test:amazon-backend
npm run test:amazon-gmail
```

## Manual send plan, not implemented

Before enabling `manual_send`, add these controls:

1. Barrier: keep all send code behind `AMAZON_MESSAGES_OUTBOUND_MODE=manual_send`, reject `disabled` and `draft_only`, and add a dedicated security test that fails on any send path outside the one approved service.
2. Permission: require a narrow permission such as `amazonMessagesSendFinal`, separate from admin, orders, and draft approval.
3. Double confirmation: require an approved PendingReply plus a fresh confirmation payload containing the exact conversation id, pending reply id, Gmail draft id, recipient, subject, and body hash shown to the user.
4. Double-send prevention: persist a final-send idempotency key and Gmail message id; reject if the PendingReply or conversation already has `SENT` or a recorded send attempt in progress.
5. Conversation status: after Gmail confirms send, mark PendingReply as `ENVIADA`, GmailDraftLink as `ENVIADO`, and conversation workflow as `CERRADO` or `RESPONDIDO`.
6. Final audit: record actor, role, permission, timestamp, recipient, subject, Gmail draft id, Gmail sent message id, body hash, confirmation hash, outbound mode, and idempotency key.

Recommended extra checks:

- block send if Gmail draft body hash differs from the approved PendingReply hash;
- block send if recipient or subject changed after approval;
- require a short cooldown between draft creation and final send;
- expose a visible final-send review panel before confirmation;
- keep `gmail.compose` unless a broader scope becomes absolutely necessary.
