# Amazon Messages Phase 0.6 - Knowledge, AI, Stats, Supervisor

Status: completed as a safe frontend/data architecture prototype.

## Scope

Phase 0.6 turns Amazon Messages from an inbox prototype into a controlled customer-support intelligence center:

- approved-response knowledge base;
- editable templates;
- AI suggestion evidence;
- operational statistics;
- product and logistics analysis;
- staff supervision KPIs;
- read-only AmazonSupportBot endpoint design.

No real Amazon mailbox, Amazon SP-API, message sending, production writes, or external model training were added.

## Architecture

Current implementation is local and deterministic:

- `amazonMessagesTypes.ts` defines the durable domain model.
- `amazonMessagesDemoData.ts` derives knowledge, templates, stats, alerts, operator metrics, and bot capabilities from sanitized demo conversations.
- `AmazonMessagesView.tsx` exposes the new sections as tabs inside `#/amazon-messages`.
- `amazonMessages.css` contains isolated operational UI styling.

The intended future architecture is:

1. Import Amazon message metadata into a database.
2. Store conversations, messages, attachments, templates, approved examples, audit events, and stats snapshots in database tables.
3. Use OpenClaw-configured AI providers through a swappable adapter.
4. Keep knowledge in the database, not inside the model.
5. Expose read-only stats endpoints to AmazonSupportBot.

## Data Model

Added model groups:

- `AmazonKnowledgeEntry`
  - category, marketplace, language, date;
  - original customer message;
  - classification;
  - AI draft;
  - final approved response;
  - approver;
  - perceived quality;
  - tags;
  - related SKU and Amazon order;
  - status: active, archived, ignored;
  - anonymized and approved-example flags;
  - human diff summary.
- `AmazonTemplate`
  - name, category, marketplace, language;
  - active, inactive, archived;
  - body and variables;
  - usage and acceptance metrics.
- `AmazonStatsSummary`
  - totals by category, marketplace, language, priority, and status;
  - business KPIs.
- `AmazonOperatorStats`
  - assigned, responded, validated;
  - time spent;
  - closed and pending cases;
  - template/AI usage;
  - corrections.
- `AmazonProductStats`
  - incident, return, technical, claim, and A-to-Z counts by SKU/ASIN.
- `AmazonLogisticsStats`
  - carrier, delays, not received, delivery problems, country.
- `AmazonSmartAlert`
  - alert title, detail, severity, metric, timestamp.
- `AmazonSupportBotCapability`
  - natural-language question;
  - real data source;
  - future endpoint.

## Screens

The module now has these tabs:

- Bandeja
  - existing conversation workflow;
  - AI suggestion panel now shows template used, approved examples consulted, confidence, and suggestion mode.
- Base de conocimiento
  - approved-response examples;
  - final response;
  - approver;
  - quality;
  - tags;
  - anonymization and opt-in controls represented in the model.
- Plantillas
  - create/edit/duplicate/archive control surface;
  - initial categories:
    - where is my order;
    - not received;
    - delayed delivery;
    - return;
    - defective product;
    - wrong product;
    - warranty;
    - invoice;
    - cancellation;
    - technical query;
    - A-to-Z;
    - refund.
- Estadisticas
  - range selector;
  - operational totals;
  - category, marketplace, language, priority breakdowns;
  - product, logistics, and template performance panels;
  - smart alerts.
- Supervisor
  - operator metrics;
  - business KPIs;
  - AmazonSupportBot capability map.

## AI Suggestion Rules

The intended suggestion order is:

1. Approved template.
2. Approved examples.
3. Controlled free generation.

Rules:

- never send automatically;
- never learn automatically;
- never use rejected responses;
- only use examples approved by a human;
- allow opt-in: `useAsApprovedExample`;
- keep human edits as diff summaries;
- allow anonymization, exclusion, review, archival, and deletion.

## Metrics

Prepared operational metrics:

- total messages;
- messages by category;
- messages by marketplace;
- messages by language;
- messages by priority;
- messages by status;
- returns;
- A-to-Z;
- not received;
- delays;
- invoices;
- warranties;
- defective product;
- wrong product.

Prepared business KPIs:

- average response time;
- average resolution time;
- open cases;
- closed cases;
- critical cases;
- template usage;
- AI usage;
- human corrections;
- accepted without changes;
- modified responses;
- discarded responses.

Prepared staff KPIs:

- assigned operator;
- responding operator;
- validating operator;
- time spent;
- response count;
- correction count;
- closed cases;
- pending cases;
- template usage;
- AI usage.

## Product And Logistics Analysis

Prepared product views:

- SKUs with most incidents;
- SKUs with most returns;
- SKUs with most technical questions;
- SKUs with most claims;
- SKUs with most A-to-Z cases.

Prepared logistics views:

- carriers with most incidents;
- carriers with most delays;
- orders not received;
- delivery problems;
- country grouping.

## Smart Alerts

Prepared alert rules:

- return spike;
- A-to-Z spike;
- not-received spike;
- SKU incident spike;
- carrier incident spike;
- marketplace incident spike.

Current phase only displays alerts. It does not execute actions.

## Future Endpoints

Prepared endpoint design:

- `GET /amazon-messages/stats/summary`
- `GET /amazon-messages/stats/operators`
- `GET /amazon-messages/stats/categories`
- `GET /amazon-messages/stats/products`
- `GET /amazon-messages/stats/marketplaces`
- `GET /amazon-messages/stats/templates`
- `GET /amazon-messages/conversations/pending`
- `GET /amazon-messages/conversations/critical`

AmazonSupportBot must answer only from these module-backed sources and must say when data is unavailable.

## Risks

- Bad examples can degrade future suggestions if approval discipline is weak.
- Staff metrics can be misread without context; quality should be measured alongside speed.
- Product incident counts need normalized SKU/ASIN mapping before operational decisions.
- Logistics conclusions need real carrier event history, not only summary tracking.
- AI-generated drafts must remain visibly untrusted until human validation.
- Privacy controls must exist before storing real customer messages.

## Decisions Pending

- Final database backend.
- Retention policy for customer messages and approved examples.
- Permission model for:
  - reading conversations;
  - approving replies;
  - managing templates;
  - managing knowledge entries;
  - viewing staff metrics.
- AI provider adapter contract.
- AmazonSupportBot read-only query interface.
- Exact anonymization rules per marketplace.

## Verification

- `npm run test:amazon-parser`
  - 10 fixtures;
  - 54 field checks;
  - passed.
- `npm run build`
  - passed.

