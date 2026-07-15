# Amazon Messages Phase 0.8 - Gmail Readonly Integration

Status: implemented as a safe readonly Gmail integration layer.

## Scope

Phase 0.8 prepares Amazon Messages to import real Amazon Seller emails from Gmail into the persistent Amazon Messages backend.

Hard limits remain:

- no email sending;
- no buyer replies;
- no Amazon SP-API Messaging;
- no Odoo writes;
- no Sendcloud writes;
- no order changes;
- no production automation.

## Decision

Chosen approach: Gmail API with OAuth readonly credentials.

Reason:

- more maintainable than IMAP for labels and incremental sync;
- supports Gmail labels directly;
- avoids using the main Google password;
- can be limited to read scopes;
- works well with future scheduled sync jobs.

`gog` is available on the host, but the currently listed OAuth account is `todoelectrico.es@gmail.com`, not `juanitoopenclaw@gmail.com`, and the file keyring needs `GOG_KEYRING_PASSWORD` in non-interactive shells. For the Dashboard backend, direct Gmail API OAuth via environment variables is the clearer production path.

## Gmail Account

Target account:

- `juanitoopenclaw@gmail.com`

Target label:

- `AmazonSeller`

The importer never scans the full inbox. It resolves the configured label and reads only messages under that label.

If the label does not exist, Gmail sync fails with a clear error:

`No existe la etiqueta Gmail "AmazonSeller". Crear una etiqueta con ese nombre y filtrar ahi los correos Amazon.`

## Security

No primary Gmail password is used.

Credentials must stay outside the repository.

Required environment variables:

- `AMAZON_MESSAGES_GMAIL_ACCOUNT=juanitoopenclaw@gmail.com`
- `AMAZON_MESSAGES_GMAIL_LABEL=AmazonSeller`
- `GMAIL_CLIENT_ID` or `GOOGLE_CLIENT_ID`
- `GMAIL_CLIENT_SECRET` or `GOOGLE_CLIENT_SECRET`
- `AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN` or `GMAIL_REFRESH_TOKEN`

Optional:

- `AMAZON_MESSAGES_GMAIL_MAX_MESSAGES=25`

Recommended OAuth scope:

- `https://www.googleapis.com/auth/gmail.readonly`

## Architecture

New backend files:

- `backend/amazonMessages/gmailClient.ts`
- `backend/amazonMessages/gmailSync.ts`

Extended files:

- `backend/amazonMessages/schema.ts`
- `backend/amazonMessages/repository.ts`
- `backend/amazonMessages/routes.ts`
- `src/modules/amazonMessages/AmazonMessagesView.tsx`
- `scripts/test-amazon-gmail-readonly.ts`
- `package.json`

Flow:

1. Gmail label `AmazonSeller`.
2. Gmail API lists messages under the label.
3. Gmail API downloads each message in raw RFC 822 format.
4. Existing Amazon parser parses headers/body.
5. Repository deduplicates.
6. Repository creates or updates conversation.
7. Repository stores message, classification, attachment metadata, sync metrics, and audit events.
8. Dashboard supervisor panel shows Gmail readonly sync metrics.

## Deduplication

Deduplication checks:

- Gmail message ID;
- RFC `Message-ID`;
- normalized body hash.

Grouping checks:

- Amazon order ID;
- Gmail thread ID;
- buyer alias.

## Persisted Gmail State

`gmailSync` is persisted in the Amazon Messages store:

- account;
- label name;
- label ID;
- last sync timestamp;
- last history ID;
- imported count;
- duplicate count;
- error count;
- pending count;
- average processing time;
- last error.

## Audit Events

Added audit events:

- `gmail_message_read`
- `gmail_conversation_created`
- `gmail_conversation_updated`
- `gmail_attachment_detected`
- `gmail_duplicate_ignored`
- `gmail_import_error`

## API

Added endpoints:

- `GET /api/amazon-messages/gmail/status`
- `POST /api/amazon-messages/gmail/sync`

Both require Dashboard login. Sync also requires Amazon Messages manage permission via mapped Dashboard role.

## Supervisor Metrics

The Amazon Messages supervisor panel now exposes:

- Gmail account;
- label;
- imported emails;
- duplicate emails;
- import errors;
- pending emails;
- average process time;
- last sync error.

## Tests

Added:

- `npm run test:amazon-gmail`

Covers:

- missing credential failure mode;
- readonly source abstraction;
- incremental sync pipeline with fake Gmail source;
- deduplication;
- same-order grouping;
- parser classification;
- attachment metadata import;
- audit events;
- Gmail sync metrics.

Existing tests remain:

- `npm run test:amazon-parser`
- `npm run test:amazon-backend`

## Current Runtime Finding

At implementation time, no environment variables for `juanitoopenclaw@gmail.com` Gmail OAuth were present in the Dashboard process environment.

Also, `gog auth list` showed only:

- `todoelectrico.es@gmail.com`

and reported that `GOG_KEYRING_PASSWORD` is needed for non-interactive token access.

Therefore, real Gmail reading is implemented but not activated until OAuth credentials for `juanitoopenclaw@gmail.com` are configured outside the repo.

## How To Activate

1. Create or reuse a Google OAuth client with Gmail readonly scope.
2. Authorize `juanitoopenclaw@gmail.com`.
3. Store the refresh token outside the repo.
4. Set the environment variables listed above.
5. Create Gmail label `AmazonSeller`.
6. Add a Gmail filter that labels Amazon Seller Central emails with `AmazonSeller`.
7. Restart the Dashboard dev/backend process.
8. Run:

```bash
curl -X POST http://127.0.0.1:5176/api/amazon-messages/gmail/sync
```

using an authenticated Dashboard session.

## Limitations

- No scheduler has been enabled yet.
- No real Gmail read occurred because credentials were unavailable.
- Raw attachment binary download is not implemented; only metadata found by the parser is stored.
- Gmail History API is prepared via `historyId` storage but not yet used for delta sync.
- The frontend still displays fixture conversations in the main inbox until the next phase wires the UI read model fully to the backend API.

## Risks

- Wrong Gmail filter could omit Amazon emails.
- Over-broad Gmail label could import unrelated emails.
- Real customer data requires retention and deletion rules before broad rollout.
- OAuth refresh token must be protected like a secret.
- Gmail API quota should be monitored once periodic sync is enabled.

## Verification

- `npm run test:amazon-gmail`
  - passed.
- `npm run test:amazon-backend`
  - passed.
- `npm run test:amazon-parser`
  - 10 fixtures;
  - 54 field checks;
  - passed.
- `npm run build`
  - passed.

