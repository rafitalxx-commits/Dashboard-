# Amazon Messages final Gmail draft send local implementation

Status: implemented and validated locally/staging only. Not deployed. One controlled
real Gmail Draft send validation was executed after explicit approval, only to the
allowlisted test recipient `rafitalxx@gmail.com`.

## Scope

This phase adds the protected real final-delivery path, but tests it only with mocks.

Rules followed:

- final delivery service uses only an existing Gmail draft id;
- no loose message creation;
- no SP-API messaging;
- no production deployment;
- no scope or credential changes;
- no production real delivery validation run.
- no alias Amazon or customer recipient used.

## Gmail Method

The isolated Gmail service calls:

```text
POST /gmail/v1/users/me/drafts/send
```

The route layer never references that Gmail path directly. The security test asserts the path appears exactly once inside the isolated Gmail client service.

`users.messages.send` is still forbidden.

## Endpoint

Protected endpoint:

```text
POST /api/amazon-messages/conversations/:conversationId/finalize
```

It requires:

- `AMAZON_MESSAGES_OUTBOUND_MODE=manual_send`;
- permission `amazonMessagesSendFinal`;
- approved/listo PendingReply;
- existing GmailDraftLink;
- matching `conversationId`, `pendingReplyId`, `gmailDraftId`, recipient, subject, and `bodyHash`;
- strong confirmation flag;
- valid idempotency key;
- conversation not already responded/closed.

## State Handling

Before the Gmail service call:

- create finalization record;
- set `SEND_IN_PROGRESS`;
- audit `final_gmail_draft_in_progress`.

After Gmail success:

- set finalization `SENT`;
- persist Gmail `sentMessageId`;
- set PendingReply `SENT`;
- mark conversation as `responded` / `CERRADO`;
- audit `final_gmail_draft_sent`.

If Gmail fails:

- set finalization `SEND_FAILED`;
- set PendingReply `SEND_FAILED`;
- keep conversation open;
- audit `final_gmail_draft_failed`.

## Idempotency

- Same idempotency key returns the same finalization and does not call Gmail again.
- Different key after `SEND_IN_PROGRESS` or `SENT` is blocked.
- Existing `sentMessageId` prevents repeat delivery.

## Future Real Validation Allowlist

If `RUN_REAL_GMAIL_SEND_VALIDATION=true`, the endpoint requires:

```text
AMAZON_MESSAGES_FINAL_SEND_ALLOWED_RECIPIENTS
```

The recipient must be explicitly listed. This is for future validation with a controlled test recipient only.

## Tests

Added:

```bash
npm run test:amazon-final-send
npm run validate:amazon-final-send-real
```

Covered:

- success through mocked Gmail draft final service;
- same idempotency key does not call Gmail twice;
- duplicate finalization with another key is blocked;
- missing `amazonMessagesSendFinal`;
- missing strong confirmation;
- `bodyHash` mismatch;
- missing Gmail draft/link;
- outbound mode other than `manual_send`;
- validation allowlist blocking;
- mocked Gmail failure leaves `SEND_FAILED` and does not close the conversation;
- success and failure audit events.

Also passed:

```bash
npm run test:amazon-outbound-security
npm run test:amazon-manual-send-mock
npm run test:amazon-backend
npm run test:amazon-gmail
npm run build
```

## Controlled Real Validation

Completed locally/staging on 2026-06-28 with explicit approval and allowlist:

```text
RUN_REAL_GMAIL_SEND_VALIDATION=true
AMAZON_MESSAGES_FINAL_SEND_ALLOWED_RECIPIENTS=rafitalxx@gmail.com
AMAZON_MESSAGES_FINAL_SEND_TEST_RECIPIENT=rafitalxx@gmail.com
```

Successful result:

```json
{
  "ok": true,
  "account": "juanitoopenclaw@gmail.com",
  "recipient": "rafitalxx@gmail.com",
  "conversationId": "amz-backend-conv-1",
  "draftId": "r7046487024289763214",
  "sentMessageId": "19f0f94562ab8783",
  "idempotentSentMessageId": "19f0f94562ab8783",
  "idempotencyPreventedRepeat": true,
  "draftDisappeared": true,
  "sentMatches": 1,
  "subject": "VALIDACION TECNICA MANUAL_SEND - PRUEBA CONTROLADA 2026-06-28T18-53-26-502Z",
  "workflowStatus": "CERRADO",
  "pendingReplyStatus": "SENT"
}
```

The final successful validation used `users.drafts.send` once for the allowlisted
test recipient. The Gmail draft disappeared from drafts, the message appeared in
Sent, and the second call with the same idempotency key returned the stored
`sentMessageId` without another delivery call.

During the first controlled attempts, Gmail returned the sent message id at the
top level of the response rather than under `message.id`; this exposed a local
response parsing bug after the allowlisted message had already been delivered.
The parser was corrected to read the top-level `id`, and the successful run above
recorded `sentMessageId` properly.

## Operator UI Final Phase

Implemented locally/staging after the controlled validation:

- final button text: `Enviar respuesta`;
- visible only when the operator has `amazonMessagesSendFinal` and the reply has
  an approved/listo PendingReply plus existing Gmail Draft data;
- status panel shows ready, sending, sent, or error;
- modal shows recipient, subject, order, marketplace, language, bodyHash, and
  reply summary;
- modal warning: `Esta acción enviará el mensaje al cliente y no se puede deshacer`;
- strong confirmation requires checking conversationId, pendingReplyId,
  gmailDraftId, recipient, subject, bodyHash, and idempotencyKey;
- frontend posts only to the protected `/finalize` endpoint and never references
  Gmail send APIs directly;
- `SEND_FAILED` keeps the conversation open and allows retry only when no
  `sentMessageId` exists;
- `SENT` marks the conversation as responded/closed in the UI after backend
  success.

Validation after UI final phase:

```bash
npm run test:amazon-final-send
npm run test:amazon-outbound-security
npm run test:amazon-manual-send-mock
npm run test:amazon-backend
npm run test:amazon-gmail
npm run build
```

All passed on 2026-06-28. No production deploy was performed and no additional
real send validation was executed in this UI phase.
