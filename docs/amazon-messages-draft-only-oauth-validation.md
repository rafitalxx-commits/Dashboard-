# Amazon Messages draft_only OAuth validation

Status: validated locally/staging with real Gmail OAuth compose token on 2026-06-28.

## Scope

Use this scope for Gmail draft creation/update:

```text
https://www.googleapis.com/auth/gmail.compose
```

Google documents `gmail.compose` as the Gmail API scope to manage drafts and send emails. The Dashboard still blocks send in code: there is no send client method, no send endpoint, and `manual_send` returns not implemented.

## Operative account

```text
juanitoopenclaw@gmail.com
```

This is the account already documented for Amazon Messages Gmail work.

## Local/staging env

Do not change production env before Rafa approves deployment.

Use draft-specific variables so the existing Gmail readonly sync token is not replaced:

```bash
export AMAZON_MESSAGES_OUTBOUND_MODE=draft_only
export AMAZON_MESSAGES_GMAIL_DRAFT_ACCOUNT=juanitoopenclaw@gmail.com
export AMAZON_MESSAGES_GMAIL_DRAFT_CLIENT_ID="..."
export AMAZON_MESSAGES_GMAIL_DRAFT_CLIENT_SECRET="..."
export AMAZON_MESSAGES_GMAIL_DRAFT_REFRESH_TOKEN="..."
export RUN_REAL_GMAIL_DRAFT_VALIDATION=true
```

Keep the existing readonly variables unchanged:

```bash
AMAZON_MESSAGES_GMAIL_ACCOUNT
AMAZON_MESSAGES_GMAIL_LABEL
AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN
```

## Reauthorization steps

1. In Google Cloud Console, confirm Gmail API is enabled for the OAuth project.
2. In OAuth consent screen, include scope:
   `https://www.googleapis.com/auth/gmail.compose`
3. Reauthorize `juanitoopenclaw@gmail.com` with offline access and forced consent, so Google returns a new refresh token.
4. Store the resulting refresh token only in local/staging as:
   `AMAZON_MESSAGES_GMAIL_DRAFT_REFRESH_TOKEN`.
5. Do not replace production `AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN`.
6. Do not set production `AMAZON_MESSAGES_OUTBOUND_MODE=draft_only` until validation is reviewed.

## Controlled validation

Run:

```bash
npm run validate:amazon-gmail-draft-real
```

The script requires `RUN_REAL_GMAIL_DRAFT_VALIDATION=true` and then:

- imports a local Gmail-like fixture into a temporary store;
- creates an approved internal draft;
- prepares and approves a PendingReply;
- creates a real Gmail draft;
- updates the same Gmail draft id;
- verifies the draft exists via Gmail API;
- confirms `manual_send` returns not implemented;
- confirms `disabled` blocks draft creation.

Then run:

```bash
npm run test:amazon-outbound-security
npm run test:amazon-backend
npm run test:amazon-gmail
npm run build
```

## Current local result

Completed after reauthorizing only `juanitoopenclaw@gmail.com` with:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.compose`
- OIDC basic email scopes

No production env file was modified and no Gmail send scope or send endpoint was enabled.

- `npm run test:amazon-outbound-security`: passed.
- `npm run test:amazon-backend`: passed.
- `npm run test:amazon-gmail`: passed.
- `npm run build`: passed.
- `npm run validate:amazon-gmail-draft-real`: passed.

Real Gmail draft validation output:

```json
{
  "ok": true,
  "account": "juanitoopenclaw@gmail.com",
  "conversationId": "amz-gmail-thread-draft-validation-2026-06-28T13-10-45-972Z",
  "gmailDraftId": "r5568834553240294093",
  "createdAndUpdatedSameDraft": true,
  "manualSend": "AMAZON_MESSAGES_OUTBOUND_MODE=manual_send no implementado: solo draft_only esta disponible",
  "disabled": "AMAZON_MESSAGES_OUTBOUND_MODE=disabled: creacion de borrador Gmail bloqueada",
  "note": "No send endpoint is called by this validation script."
}
```

The draft was read back from Gmail with label `DRAFT`, recipient
`buyer-2026-06-28T13-10-45-972Z@marketplace.amazon.test`, and subject
`Re: Mensaje Amazon`.
