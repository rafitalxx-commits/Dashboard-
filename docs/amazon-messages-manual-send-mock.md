# Amazon Messages manual_send_mock

Status: implemented locally, not deployed to production.

## Scope

This phase designs and tests the final-response workflow without calling any real external delivery API.

Rules:

- no real Gmail final delivery;
- no Gmail final-delivery API paths or client methods;
- no SP-API messaging;
- no OAuth scope changes;
- no production deployment in this phase.

## Endpoint

Mock finalization endpoint:

```text
POST /api/amazon-messages/conversations/:conversationId/finalize-mock
```

It only runs when:

```text
AMAZON_MESSAGES_OUTBOUND_MODE=manual_send
```

The existing Gmail draft endpoint still rejects `manual_send`.

## Required Permission

The final mock requires the specific permission:

```text
amazonMessagesSendFinal
```

This is intentionally separate from admin/order/draft permissions.

## Strong Confirmation

The request must include:

- `conversationId`;
- `pendingReplyId`;
- `gmailDraftId`;
- `recipient`;
- `subject`;
- `bodyHash`;
- `confirmFinalSendMock: true`;
- `idempotencyKey`;
- `externalSend: false`.

The backend verifies every value against the approved PendingReply and stored Gmail draft link.

## States

Implemented states:

- `READY_TO_SEND`
- `SEND_IN_PROGRESS`
- `SENT_MOCK`
- `SEND_FAILED`

Successful mock finalization marks the PendingReply as `SENT_MOCK` and closes/responds the conversation in mock mode.

## Idempotency And Double-Click Protection

- The same `idempotencyKey` returns the same finalization result.
- A second key for an already finalized PendingReply is rejected.
- In-progress and finalized records block duplicate finalization.

## Auditing

Audit records include:

- actor and role;
- finalization id;
- Gmail draft id;
- recipient;
- subject;
- body hash;
- confirmation hash;
- idempotency key;
- mock message id;
- explicit note that no real delivery API was called.

## Tests

Added:

```bash
npm run test:amazon-manual-send-mock
npm run validate:amazon-manual-send-mock-flow
```

Covered negative tests:

- missing permission;
- missing confirmation;
- body hash mismatch;
- missing draft;
- double click / duplicate finalization;
- outbound mode other than `manual_send`;
- real delivery attempt blocked.

Also re-run successfully:

```bash
npm run test:amazon-outbound-security
npm run test:amazon-backend
npm run test:amazon-gmail
npm run build
```

## Functional Local Validation

Completed locally/staging on 2026-06-28 without deploying to production:

```json
{
  "ok": true,
  "account": "juanitoopenclaw@gmail.com",
  "conversationId": "amz-gmail-19eea90e9ab3a41b",
  "gmailDraftId": "r918328933634795283",
  "createdAndUpdatedSameDraft": true,
  "finalizationId": "manual-send-mock-1782661116796-1",
  "finalStatus": "SENT_MOCK",
  "duplicateBlocked": "Doble envio bloqueado por manual_send_mock",
  "pendingReplyStatus": "SENT_MOCK",
  "workflowStatus": "CERRADO",
  "auditEvents": [
    "manual_send_mock_ready",
    "manual_send_mock_in_progress",
    "manual_send_mock_sent"
  ],
  "sentMatches": 0,
  "draftCleanedUp": true
}
```

Validation used a temporary copy of the Amazon Messages store and a real imported
Gmail conversation. It created and updated a real Gmail draft, switched only the
validation process to `manual_send`, finalized through the mock endpoint, verified
idempotency and audit, searched Gmail Sent with zero matches, and deleted the
validation draft afterward.
