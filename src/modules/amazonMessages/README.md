# Amazon Messages Prototype - Phase 0.6

Status: internal, non-destructive prototype.

This module exists to test the operational shape of Amazon Messages inside the Dashboard before connecting real systems. Phase 0.6 extends the inbox/classifier into an internal knowledge, AI suggestion, analytics, and supervision center.

## What Exists

- Separate frontend module under `src/modules/amazonMessages/`.
- Navigable Dashboard view: `#/amazon-messages`.
- Demo inbox generated from sanitized Amazon-like relay emails.
- Email parser:
  - headers;
  - `X-Space-Notification-Type`;
  - subject;
  - clean body;
  - Amazon order ID;
  - buyer alias;
  - marketplace;
  - marketplace ID;
  - language;
  - SKU;
  - ASIN;
  - quantity;
  - amount;
  - return/reason/status fields;
  - attachment names;
  - operational queue;
  - recommended action;
  - priority;
  - international/local return address risk;
  - normalized body hash.
- Deduplication by:
  - `Message-ID`;
  - UID;
  - normalized body hash.
- Conversation grouping demo by imported email/order.
- Read-only matching against current Dashboard orders.
- Odoo order panel.
- Sendcloud tracking panel.
- Odoo invoice panel.
- AI demo classification and draft.
- Editable draft field with send disabled.
- Internal audit timeline.
- Parser tests in `scripts/test-amazon-email-parser.ts`.
- Attachment metadata and validation:
  - image/PDF/text/other detection;
  - sanitized filenames;
  - MIME and extension normalization;
  - hash and size metadata;
  - dangerous extension blocking;
  - incoming and outgoing attachment UI prepared without real sending.
- Phase 0.6 knowledge layer:
  - approved examples;
  - human diff summaries;
  - anonymization flags;
  - approved-example opt-in.
- Editable template catalog with the initial support categories.
- AI suggestion evidence:
  - selected template;
  - consulted approved examples;
  - confidence;
  - no automatic send.
- Operational statistics:
  - categories;
  - marketplaces;
  - languages;
  - priorities;
  - statuses;
  - product incidents;
  - logistics incidents.
- Business and staff KPIs:
  - average response time;
  - open/closed/critical cases;
  - template and AI usage;
  - human corrections;
  - operator workload.
- Smart alert placeholders for A-to-Z, SKU, carrier, marketplace, and volume spikes.
- AmazonSupportBot capability map backed by future module endpoints.
- Phase 0.7 backend foundation:
  - separated backend under `backend/amazonMessages/`;
  - persistent local store following the existing Dashboard JSON-store pattern;
  - migration-ready SQL schema definitions;
  - internal API routes under `/api/amazon-messages/*`;
  - Amazon Messages roles and permissions;
  - audit logging for template, classification, and assignment changes;
  - repository tests for persistence and permissions.
- Phase 0.8 Gmail readonly foundation:
  - Gmail API/OAuth readonly client;
  - label-only import from `AmazonSeller`;
  - raw Gmail message import through the existing parser;
  - conversation grouping by order/thread/buyer;
  - deduplication by Gmail ID, `Message-ID`, and normalized hash;
  - Gmail import audit events;
  - supervisor metrics for imported, duplicate, pending, error, and processing time counts;
  - readonly sync endpoints.

## Hard Safety Boundaries

- No real Amazon mailbox connection.
- No Amazon SP-API connection.
- No real message sending.
- No writes to Odoo.
- No writes to Sendcloud.
- No production database migration.
- Demo state changes are React state only and disappear on reload.
- AI suggestions are deterministic demo data; no external model training occurs.
- Backend state is persisted locally in `DASHBOARD_DATA_DIR/amazon-messages-store.json`
  or `.dashboard-data/amazon-messages-store.json` during development.

## Current Data Source

`amazonMessagesDemoData.ts` contains sanitized raw email strings that simulate Amazon relay emails. Real `.eml` files must not be committed to the repository.

The first demo orders are enriched in memory with Amazon order refs so the prototype can show exact and unmatched matching states. This does not mutate Odoo or stored Dashboard data.

## Files

- `AmazonMessagesView.tsx`: UI shell, inbox, conversation, panels, draft, audit.
- `amazonMessagesTypes.ts`: local support model types.
- `amazonEmailParser.ts`: parser, operational classifier, extraction rules, and deduplication helpers.
- `amazonMessagesDemoData.ts`: demo email fixtures and conversation builder.
- `amazonMessages.css`: isolated module styling.
- `scripts/test-amazon-email-parser.ts`: parser regression tests.
- `docs/amazon-messages-phase-0-4-parser-classifier.md`: phase 0.4 report.
- `docs/amazon-messages-phase-0-5-attachments.md`: phase 0.5 attachment architecture.
- `docs/amazon-messages-phase-0-6-knowledge-ai-stats.md`: phase 0.6 knowledge, AI, stats, and supervisor architecture.
- `docs/amazon-messages-phase-0-7-backend-persistence.md`: phase 0.7 backend, persistence, roles, endpoints, and risks.
- `docs/amazon-messages-phase-0-8-gmail-readonly.md`: phase 0.8 Gmail readonly import architecture and activation notes.

## Pending Decisions

- Mailbox provider:
  - Gmail API;
  - IMAP;
  - Microsoft/other provider.
- Storage backend:
  - SQLite is recommended for isolated MVP.
  - Postgres should be considered before the module becomes critical operations infrastructure.
- Attachment storage:
  - local filesystem;
  - object storage;
  - database metadata with file hash.
- Odoo invoice PDF:
  - validate how the Dashboard should retrieve/send invoice PDFs without duplicating them.
- Sendcloud event depth:
  - current Dashboard context has summary tracking;
  - support replies may need full event history.
- Permissions:
  - add dedicated permissions later:
    - `amazonMessagesRead`;
    - `amazonMessagesReply`;
    - `amazonMessagesManage`;
    - `amazonMessagesAi`.
- Persistence:
  - design final storage schema for conversations, templates, knowledge entries, audit events, and stats snapshots.
- AmazonSupportBot:
  - implement read-only tool endpoints before enabling natural-language answers.
- AI provider:
  - wire configured OpenClaw provider behind a swappable model adapter.

## Parser Check

Run:

```bash
npm run test:amazon-parser
npm run test:amazon-backend
npm run test:amazon-gmail
```

Current automated extraction result: 54/54 expected fields pass on sanitized parser and attachment fixtures.
