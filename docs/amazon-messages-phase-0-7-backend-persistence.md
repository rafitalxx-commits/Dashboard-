# Amazon Messages Phase 0.7 - Backend, Persistence, Permissions

Status: completed as a safe backend foundation.

## Scope

Phase 0.7 moves Amazon Messages from frontend-only demo state toward a persistent internal module.

Still not connected:

- no Amazon mailbox;
- no Amazon SP-API;
- no message sending;
- no Odoo writes;
- no Sendcloud writes;
- no production business process changes.

## Existing Dashboard Storage

The Dashboard currently uses Vite middleware as a lightweight backend and persists local development data as JSON stores for auth, tasks, and calendar.

Because there is no existing SQL database in this codebase, Phase 0.7 follows the existing local-store pattern instead of adding a new database dependency. The module also includes SQL schema definitions so it can migrate later to SQLite/Postgres without redesigning the domain.

Current local path:

- `DASHBOARD_DATA_DIR/amazon-messages-store.json`, when `DASHBOARD_DATA_DIR` is configured.
- `.dashboard-data/amazon-messages-store.json`, fallback for development.

## File Layout

Frontend remains isolated:

- `src/modules/amazonMessages/`

Backend is separated:

- `backend/amazonMessages/schema.ts`
- `backend/amazonMessages/seed.ts`
- `backend/amazonMessages/repository.ts`
- `backend/amazonMessages/routes.ts`

The Vite backend registers Amazon Messages routes from `vite.config.ts`.

## Data Model

Persistent entities:

- Conversations
- Messages
- Attachments
- Templates
- KnowledgeExamples
- Classifications
- AuditLogs
- OperatorAssignments
- StatisticsSnapshots
- Alerts

## Tables

Designed SQL tables:

- `amazon_conversations`
- `amazon_messages`
- `amazon_attachments`
- `amazon_templates`
- `amazon_knowledge_examples`
- `amazon_audit_logs`

The current JSON store also includes:

- `classifications`
- `operatorAssignments`
- `statisticsSnapshots`
- `alerts`

These should become SQL tables in the first database migration:

- `amazon_classifications`
- `amazon_operator_assignments`
- `amazon_statistics_snapshots`
- `amazon_alerts`

## Relationships

- A conversation has many messages.
- A conversation has many attachments.
- A message can have many attachments.
- A conversation has many classifications over time.
- A conversation has many audit logs.
- A conversation has many operator assignment records.
- Templates are reusable by category, language, and marketplace.
- Knowledge examples are reusable only when approved and not archived/ignored.
- Statistics snapshots aggregate conversation, message, template, AI, operator, product, and logistics metrics.
- Alerts are generated from snapshots or metric rules.

## Conversation Persistence

Stored fields include:

- `conversationId`
- category
- priority
- status
- marketplace
- language
- Amazon order ID
- Odoo order ID
- assigned user
- created/updated timestamps
- first/last message timestamps
- response/resolution metrics
- message count

## Message Persistence

Stored fields include:

- `messageId`
- `conversationId`
- sender
- direction
- content
- classification
- language
- timestamp
- Amazon metadata JSON

## Attachment Persistence

Only metadata is persisted in this phase:

- attachment ID
- conversation ID
- message ID
- original and sanitized name
- hash
- size
- MIME
- origin
- storage status
- timestamp

No real attachment binaries are stored.

## Roles

Amazon Messages roles:

- `ADMIN`
- `SUPERVISOR`
- `OPERADOR`
- `LECTURA`
- `AGENTE_IA`

Permissions:

- `amazonMessages:read`
- `amazonMessages:manage`
- `amazonMessages:supervise`
- `amazonMessages:validate`
- `amazonMessages:aiDraft`
- `amazonMessages:admin`

Current mapping from Dashboard users:

- Dashboard admin or settings permission -> `ADMIN`
- Orders + billing permissions -> `SUPERVISOR`
- Orders permission -> `OPERADOR`
- Other authenticated users -> `LECTURA`
- System/AI actors can use `AGENTE_IA` internally.

## Permission Rules

- `ADMIN`
  - full access.
- `SUPERVISOR`
  - read, validate, supervise.
- `OPERADOR`
  - read, manage conversations/templates, validate, generate drafts.
- `LECTURA`
  - read only.
- `AGENTE_IA`
  - controlled read and draft generation only.

The AI role is intentionally unable to assign, approve, archive, send, or change business state directly.

## API

Implemented under the current Dashboard API prefix:

- `GET /api/amazon-messages/conversations`
- `GET /api/amazon-messages/conversations/{id}`
- `GET /api/amazon-messages/conversation/{id}`
- `GET /api/amazon-messages/conversations/pending`
- `GET /api/amazon-messages/conversations/critical`
- `GET /api/amazon-messages/stats`
- `GET /api/amazon-messages/templates`
- `GET /api/amazon-messages/knowledge`
- `GET /api/amazon-messages/operators`
- `POST /api/amazon-messages/template`
- `POST /api/amazon-messages/classification`
- `POST /api/amazon-messages/assignment`

These are internal module endpoints only. They do not call Amazon, Odoo, Sendcloud, or mailbox providers.

## Audit

Audited events implemented:

- `template_created`
- `classification_changed`
- `assignment_changed`

Audited event model also supports:

- message imported;
- classification changed;
- template modified;
- draft generated;
- draft approved;
- responsible user changed;
- attachment received/viewed/downloaded;
- knowledge approved/archived;
- response approved/discarded.

## Statistics

Statistics snapshots are persisted instead of requiring every panel to recalculate all metrics from raw records.

Current snapshot fields are generic metric maps. Future migrations should normalize these into snapshot rows when needed for long-term trend queries.

Prepared metric areas:

- pending messages;
- critical messages;
- returns;
- A-to-Z;
- operator productivity;
- product incidents;
- logistics incidents;
- template usage;
- AI usage.

## AmazonSupportBot

The backend now has the read-side structure needed for future AmazonSupportBot queries.

Rules for the future bot:

- answer only from module data;
- never invent missing metrics;
- never perform write actions;
- use read-only endpoints for pending, critical, stats, operators, templates, products, and marketplace views.

## Tests

Added:

- `npm run test:amazon-backend`

Covered:

- seed store creation;
- persistent conversation reads;
- detail reads with messages;
- template creation;
- classification changes;
- assignment changes;
- audit log creation;
- read-only permission blocking;
- supervisor/admin operator stats access;
- stats access.

Existing parser tests remain:

- `npm run test:amazon-parser`

## Risks

- JSON persistence is appropriate for this safe development phase, but it is not the final production database.
- Concurrent writes are simple file writes; production needs transactional storage.
- Current role mapping reuses Dashboard permissions and should become explicit Amazon permissions later.
- API routes are internal but still need rate limiting and stricter input validation before production.
- Real customer data requires retention, deletion, anonymization, and access-policy decisions.
- Statistics snapshots need clear schedule and invalidation rules before real operations.

## Decisions Pending

- Final database: SQLite MVP vs Postgres for production.
- Migration runner and schema versioning strategy.
- Whether attachments metadata and binary storage live together or split between DB/object storage.
- Exact Amazon Messages permission UI.
- Retention period for conversations and knowledge examples.
- Supervisor visibility rules for staff metrics.
- AmazonSupportBot query contract and audit policy.
- Cache invalidation strategy for statistics snapshots.

## Verification

- `npm run test:amazon-backend`
  - passed.
- `npm run test:amazon-parser`
  - 10 fixtures;
  - 54 field checks;
  - passed.
- `npm run build`
  - passed.

