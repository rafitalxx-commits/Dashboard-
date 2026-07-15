# Amazon Messages - Phase 0.2 Hybrid MVP Design

Date: 2026-06-19
Scope: architecture, data model, wireframes, workflow, roadmap.
Status: design only. No live Amazon connection, no real send, no production modification.

## 1. Official Product Decision

Amazon Messages will not be a Seller Central clone.

It will be the TodoElectrico Customer Support Operations Center for Amazon cases, with Amazon as one communication source and the Dashboard as the working surface.

Core decision from Phase 0.1:

- Amazon SP-API Messaging is not a complete inbox/thread-reading API.
- The MVP must be hybrid:
  - inbound buyer messages through Amazon Buyer-Seller Messaging email relay;
  - SP-API for order-linked allowed actions and outbound messages where supported;
  - Odoo for order, invoice, customer, and product truth;
  - Sendcloud for shipping truth;
  - AI for classification and drafts only.

## 2. Design Principles

- One screen should answer: who is asking, what order, where is it, what invoice exists, what happened, what should we answer.
- Do not duplicate Odoo data. Store IDs, references, snapshots for audit, and workflow state only.
- Do not duplicate Sendcloud logistics. Store tracking references and last enrichment metadata only.
- Do not assume Amazon allows a message action. Always ask SP-API for allowed actions before enabling send.
- Human approval is mandatory for every outgoing Amazon message.
- Inbox ingestion and send must be decoupled. Receiving an email does not imply SP-API can reply with the desired action.

## 3. Inbound Message Architecture

### 3.1 Primary Inbound Source: Amazon Email Relay

Amazon Buyer-Seller Messaging supports communication through Seller Central and email using Amazon's anonymized/encrypted buyer email system. Because SP-API does not expose a complete inbound inbox, the MVP should import these email messages.

Recommended flow:

1. Configure Seller Central Buyer Messages notification/relay to a dedicated mailbox.
2. Dashboard backend imports from that mailbox using IMAP or Gmail API.
3. Each imported email is parsed into a normalized message envelope.
4. The parser extracts:
   - Amazon order ID when present;
   - buyer anonymized email/alias;
   - marketplace/language hints;
   - subject;
   - message body;
   - attachments;
   - Amazon relay message IDs and email headers;
   - received timestamp.
5. Store normalized support message and link or create conversation.

No scraping is used.

### 3.2 Alternative Official Inputs

- Seller Central manual inbox: source of truth for humans today, but not a Dashboard integration.
- SP-API Notifications: useful for order events, not buyer-message inbox events.
- SP-API Messaging: useful for order-linked outbound actions, not inbound reading.
- Reports API: no reliable buyer-message inbox surface identified in Phase 0.1.

So the official/low-risk path is email relay for inbound plus SP-API for validated outbound.

### 3.3 Duplicate Detection

Deduplication must happen before creating a message.

Priority keys:

1. Exact external source ID:
   - email `Message-ID`;
   - provider-specific Gmail/IMAP UID;
   - Amazon relay headers if available.
2. Conversation key:
   - Amazon order ID when present;
   - buyer alias;
   - normalized subject;
   - marketplace;
   - received time bucket.
3. Body fingerprint:
   - SHA-256 of normalized body + normalized subject + sender alias + received date bucket.

Rules:

- If `Message-ID` already exists, ignore as duplicate.
- If body fingerprint matches inside the same conversation within 48 hours, mark as possible duplicate and do not notify operator twice.
- If same order but different body, append to the existing conversation.
- If no order ID is found, group by buyer alias + normalized subject, then require manual link when ambiguous.

### 3.4 Conversation Grouping

Conversation matching order:

1. Amazon order ID found in subject/body/header.
2. Existing thread headers: `In-Reply-To`, `References`.
3. Buyer alias + normalized subject.
4. Manual operator merge.

Conversation split rules:

- If one buyer alias references two different Amazon order IDs, create separate conversations.
- If no order ID exists and the thread changes topic/category, allow manual split.
- Never merge across marketplaces automatically unless the Amazon order ID matches.

## 4. Order Relationship Architecture

### 4.1 Matching Chain

Goal: associate automatically with minimum manual work.

```text
Inbound email/message
  -> extract Amazon order ID
  -> match Odoo order by externalRef/client_order_ref/origin
  -> read Odoo order context
  -> read invoice context
  -> read Sendcloud by order reference/tracking
  -> build conversation context package
```

### 4.2 Matching Strategy

Primary identifiers:

- Amazon order ID from relay email.
- Existing Dashboard/Odoo `externalRef`.
- Odoo sale order `client_order_ref`.
- Odoo sale order `origin`.
- Sendcloud parcel `reference` or tracking relation.

Fallback identifiers:

- Buyer alias.
- Customer display name.
- SKU/product names.
- Order date window.
- Amount when available.

Confidence levels:

- `exact`: Amazon order ID matches one Odoo order.
- `strong`: order ID missing but buyer/date/amount/product strongly match one order.
- `weak`: several possible orders.
- `unmatched`: no candidate.

Operator rules:

- Exact/strong matches can auto-link.
- Weak matches show candidates and require manual confirmation.
- Unmatched messages remain actionable, but order panels show "Sin pedido vinculado".

### 4.3 Context Package

For each conversation, build a read-only context object:

- `amazonOrderId`
- `odooOrderId`
- `odooRef`
- `clientDisplayName`
- `orderDate`
- `marketplace`
- `products`
- `invoiceRef`
- `invoiceStatus`
- `invoicePdfAvailable`
- `deliveryStatus`
- `sendcloudTrackingNumber`
- `sendcloudTrackingUrl`
- `sendcloudCarrier`
- `sendcloudLastEvent`
- `contextFreshness`

This is generated on read and cached briefly. The conversation stores references and audit snapshots, not the master data.

## 5. Data Model

Use a channel-generic support model so future marketplaces and email/WhatsApp can reuse it.

### 5.1 `support_conversation`

- `id`
- `channel`: `amazon`
- `marketplace_id`
- `amazon_order_id`
- `odoo_order_id`
- `customer_display_name`
- `buyer_alias_hash`
- `subject_normalized`
- `status`: `new`, `open`, `pending_customer`, `pending_internal`, `resolved`, `archived`
- `category`: `tracking`, `delay`, `invoice`, `warranty`, `defect`, `return`, `cancellation`, `technical`, `logistics_incident`, `other`
- `priority`: `low`, `normal`, `high`, `urgent`
- `assigned_user_id`
- `unread_count`
- `last_message_at`
- `match_confidence`: `exact`, `strong`, `weak`, `unmatched`
- `created_at`
- `updated_at`

Store only display name and hashed buyer alias unless plain alias is required for reply handling.

### 5.2 `support_message`

- `id`
- `conversation_id`
- `direction`: `inbound`, `outbound`, `internal`
- `source`: `amazon_email_relay`, `amazon_sp_api`, `operator_note`, `system`
- `external_message_id`
- `email_message_id`
- `email_thread_id`
- `from_label`
- `to_label`
- `subject`
- `body_text`
- `body_html_ref`
- `normalized_body_hash`
- `received_at`
- `sent_at`
- `created_at`

### 5.3 `support_attachment`

- `id`
- `message_id`
- `conversation_id`
- `source`
- `filename`
- `mime_type`
- `size_bytes`
- `storage_ref`
- `sha256`
- `amazon_upload_id`
- `created_at`

Attachments are stored once by hash. Invoice PDFs should be referenced from Odoo when possible instead of duplicated.

### 5.4 `support_ai_classification`

- `id`
- `conversation_id`
- `message_id`
- `category`
- `priority`
- `intent`
- `language`
- `confidence`
- `signals_json`
- `model`
- `created_at`
- `accepted_by_user_id`
- `corrected_category`

### 5.5 `support_ai_draft`

- `id`
- `conversation_id`
- `source_message_id`
- `category`
- `template_id`
- `draft_body`
- `confidence`
- `context_snapshot_json`
- `model`
- `status`: `suggested`, `edited`, `accepted`, `rejected`, `sent`
- `created_at`
- `accepted_at`
- `rejected_at`

### 5.6 `support_template`

- `id`
- `channel`
- `category`
- `title`
- `body`
- `variables_json`
- `active`
- `created_by`
- `updated_at`

Template variables:

- `cliente`
- `pedido_amazon`
- `pedido_odoo`
- `transportista`
- `tracking`
- `url_tracking`
- `fecha_pedido`
- `marketplace`
- `factura`
- `producto`

### 5.7 `support_audit_event`

- `id`
- `conversation_id`
- `message_id`
- `user_id`
- `event_type`
- `before_json`
- `after_json`
- `source_ip`
- `created_at`

Event types:

- `message_imported`
- `conversation_linked`
- `conversation_merged`
- `conversation_split`
- `category_changed`
- `priority_changed`
- `assigned`
- `ai_classified`
- `ai_draft_created`
- `draft_edited`
- `reply_validated`
- `reply_sent`
- `attachment_added`
- `invoice_attached`
- `status_changed`

## 6. API Design

No live Amazon send in MVP design. These endpoints describe final shape, with send gated.

### 6.1 Inbox

- `GET /api/support/conversations?channel=amazon`
- Filters:
  - status
  - unread
  - category
  - priority
  - marketplace
  - owner
  - match confidence
  - date range

### 6.2 Conversation Detail

- `GET /api/support/conversations/:id`
  - messages
  - attachments
  - audit timeline
  - current Odoo/Sendcloud context
  - AI classification/drafts
  - SP-API send capability status, if checked

### 6.3 Linking

- `POST /api/support/conversations/:id/link-order`
- `POST /api/support/conversations/:id/unlink-order`
- `POST /api/support/conversations/:id/merge`
- `POST /api/support/conversations/:id/split`

### 6.4 AI

- `POST /api/support/conversations/:id/classify`
- `POST /api/support/conversations/:id/drafts`
- `PATCH /api/support/drafts/:id`
- `POST /api/support/drafts/:id/reject`

### 6.5 Amazon Validation and Send

- `POST /api/amazon/messages/:conversationId/check-actions`
  - calls `getMessagingActionsForOrder`
  - returns allowed actions and schemas
- `POST /api/amazon/messages/:conversationId/send`
  - disabled until approved phase
  - requires human user, allowed action, audit, and role permission

### 6.6 Ingestion

- `POST /api/support/ingest/email/test`
  - local/demo parsing only
- future cron/worker:
  - fetch email
  - parse
  - deduplicate
  - link
  - classify
  - notify dashboard

## 7. UX Design

The UI should be dense, operational, and closer to helpdesk software than a marketing dashboard.

### 7.1 Navigation

Sidebar:

- Amazon Messages
  - Inbox
  - Pendientes
  - Respondidos
  - Garantias
  - Facturas
  - Logistica
  - Configuracion

### 7.2 Main Inbox Wireframe

```text
+--------------------------------------------------------------------------------+
| Amazon Messages                 [Buscar pedido/cliente/texto] [Filtros] [Sync] |
+------------------+------------+-------------------+------------+------+--------+
| Prioridad        | Marketplace| Cliente           | Pedido     | Cat. | Estado |
+------------------+------------+-------------------+------------+------+--------+
| Urgente          | Amazon ES  | Maria G.          | 123-...    | Log. | Nuevo  |
| Alta             | Amazon FR  | Client Amazon     | 404-...    | Fact.| Pend.  |
| Normal           | Amazon ES  | Juan P.           | Sin link   | Tec. | Abierto|
+------------------+------------+-------------------+------------+------+--------+
| Left rail filters: unread, pending, urgent, warranty, invoices, returns, owner |
+--------------------------------------------------------------------------------+
```

Rows must show:

- unread indicator;
- priority;
- marketplace;
- customer;
- Amazon order ID / Odoo ref;
- category;
- last message preview;
- last message age;
- owner;
- quick actions: assign, mark resolved, open.

### 7.3 Conversation Workspace Wireframe

```text
+--------------------------------------------------------------------------------+
| Amazon ES  | Pedido 123-1234567-1234567 | Tracking | Factura | Asignar | Resolver |
+-----------------------+-----------------------------------+--------------------+
| Cliente               | Conversacion                      | Contexto Operativo |
| - Nombre/Alias        |                                   |                    |
| - Marketplace         | Buyer: Donde esta mi pedido?      | Pedido Odoo        |
| - Historial           |                                   | - SO12345          |
| - Pedidos previos     | Sistema: clasificado Logistica    | - Estado entrega   |
| - Riesgos             |                                   | - Productos        |
|                       | IA sugerida:                      |                    |
|                       | [borrador editable]               | Sendcloud          |
|                       |                                   | - Transportista    |
|                       | Respuesta final                   | - Tracking URL     |
|                       | [editor] [Adjuntar factura]       | - Ultimo evento    |
|                       | [Validar Amazon] [Enviar]         |                    |
|                       |                                   | Factura Odoo       |
|                       | Notas internas                    | - Estado           |
+-----------------------+-----------------------------------+--------------------+
```

### 7.4 Panel Cliente

Shows:

- buyer alias/display name;
- marketplace;
- language;
- previous conversations;
- previous linked orders;
- warning tags: repeated issue, warranty history, refund risk, no order link.

### 7.5 Panel Pedido

Shows from Odoo:

- Odoo ref;
- Amazon external ref;
- order date;
- products;
- fulfillment FBA/FBM;
- invoice state;
- delivery state;
- customer country/city;
- available actions.

### 7.6 Panel Tracking

Shows from Sendcloud:

- carrier;
- tracking number;
- tracking URL;
- current status;
- last event;
- last updated;
- incident flag.

If Sendcloud data is missing, show clear state and do not let AI invent tracking.

### 7.7 Panel IA

Shows:

- detected intent;
- confidence;
- data used;
- suggested response;
- missing data warnings;
- template used;
- approve/edit/reject buttons.

The AI panel must always be subordinate to the human editor.

## 8. AI Design

### 8.1 Classification

Initial classifier:

- deterministic rules first;
- AI classifier second when ambiguous;
- manual override always available.

Categories:

- tracking;
- delay;
- invoice;
- warranty;
- defective product;
- return;
- cancellation;
- logistics incident;
- technical question;
- other.

Confidence:

- `high`: can draft response if order context exists;
- `medium`: draft allowed with warning;
- `low`: ask operator to classify manually.

### 8.2 Draft Generation

Draft context must include:

- latest buyer message;
- conversation history;
- category;
- Odoo order context;
- Sendcloud context;
- invoice status;
- template/knowledge snippet;
- marketplace/language;
- safety rules.

Hard rules:

- Never promise refund, replacement, cancellation, or delivery date unless source data proves it.
- Never send automatically.
- Never include internal Odoo/Sendcloud IDs unless useful to customer.
- If context is missing, draft should say what the operator must check.

### 8.3 Templates and Knowledge Base

MVP templates:

- seguimiento con tracking disponible;
- seguimiento sin tracking;
- retraso transporte;
- factura disponible;
- factura pendiente;
- producto defectuoso;
- garantia;
- devolucion;
- consulta tecnica;
- cancelacion.

Knowledge base objects:

- category;
- title;
- answer policy;
- allowed promises;
- forbidden phrases;
- variables;
- active marketplaces/languages.

## 9. Audit Design

Every important action creates an immutable audit event:

- imported message;
- deduplication decision;
- order auto-link;
- manual link/unlink;
- classification;
- AI draft creation;
- draft edit;
- final send validation;
- final send result;
- attachment/invoice added;
- status/owner change.

For AI-assisted replies, store:

- original buyer message;
- AI draft;
- final sent text;
- diff summary;
- model;
- context snapshot;
- user who approved.

## 10. MVP Version 1

### Included

- Local module architecture and UI shell.
- Inbox with imported/demo email relay messages.
- Conversation grouping and deduplication logic.
- Automatic matching to Odoo order when Amazon order ID exists.
- Sendcloud context panel.
- Invoice context panel.
- Manual status/category/priority/owner.
- AI classification and draft generation in non-sending mode.
- Templates.
- Audit trail.
- SP-API action check design, optionally stubbed, but no real send.

### Excluded

- Real Amazon send.
- Automated replies.
- Seller Central scraping.
- Full omnichannel support.
- Refund/replacement automation.
- Production mailbox ingestion without separate approval.
- Production database migration without backup/approval.

### Dependencies

- Dedicated Amazon buyer-message mailbox.
- Seller Central notification/email relay configuration.
- Approved Amazon SP-API app roles.
- Odoo order matching quality by Amazon external ref.
- Sendcloud tracking lookup reliability.
- Storage choice for operational support data.

### Main Risks

- Amazon relay email formats may vary by marketplace/language.
- Some buyer messages may not include enough order context.
- Seller Central settings may require manual configuration.
- SP-API may not allow the desired response action for a specific order.
- Current Vite-middleware backend is not ideal for long-running ingestion workers.
- Local JSON storage is risky for real operational inbox data.

## 11. Roadmap

### Phase 0.3 - Technical Prototype Design Approval

- Confirm mailbox provider and access method.
- Define storage backend: SQLite recommended for MVP, Postgres later if volume grows.
- Define exact message parser contract using sample relay emails.
- Approve UI wireframes.

### Phase 1 - Non-Destructive MVP Shell

- Add `src/modules/amazonMessages/`.
- Add navigation and route.
- Add demo/imported message inbox.
- Add conversation view with Odoo/Sendcloud context lookup.
- Add manual workflow state and audit.
- No real Amazon send.

### Phase 2 - Inbound Ingestion

- Connect dedicated mailbox in controlled mode.
- Parse real relay emails.
- Deduplicate and group conversations.
- Add order matching confidence.
- Add operator manual link tools.

### Phase 3 - AI and Templates

- Add classification.
- Add draft generation.
- Add editable templates.
- Add confidence and missing-data warnings.
- Track AI draft/final-answer diffs.

### Phase 4 - SP-API Send Validation

- Check allowed message actions for linked order.
- Add invoice upload/send preparation.
- Keep send disabled until a controlled test order succeeds.

### Phase 5 - Controlled Send

- Enable sending for selected users and selected message types.
- Require preview, validation, and audit.
- Add fallback policy if SP-API action unavailable.

### Phase 6 - Omnichannel Foundation

- Generalize support model for Prestashop, Leroy Merlin, ManoMano, email, WhatsApp, Telegram, and web chat.
- Add KPIs, SLAs, and workload dashboards.

## 12. Implementation Boundary Recommendation

When development starts, do not keep expanding `App.tsx` and `vite.config.ts`.

Recommended structure:

- `src/modules/amazonMessages/`
  - UI components
  - local types
  - demo data
  - client wrapper
- `src/services/supportTypes.ts`
  - channel-generic conversation/message/audit types
- `server/support/`
  - repository
  - email ingestion
  - parser
  - matcher
  - audit
  - classifier
- `server/amazon/`
  - SP-API client
  - action checker
  - future sender

Short-term Vite routes may call separated server modules, but the business logic should not live inside `vite.config.ts`.

## 13. Sources and Reference Points

- Amazon Buyer-Seller Messaging Service overview: https://sellercentral.amazon.com/help/hub/reference/external/G202125900
- Amazon Messaging API: https://developer-docs.amazon.com/sp-api/docs/messaging-api
- Amazon Messaging v1 reference: https://developer-docs.amazon.com/sp-api/reference/messaging-v1
- getMessagingActionsForOrder: https://developer-docs.amazon.com/sp-api/reference/getmessagingactionsfororder
- Send a message tutorial: https://developer-docs.amazon.com/sp-api/docs/send-a-message
- Notification type values: https://developer-docs.amazon.com/sp-api/docs/notification-type-values
- Notifications API: https://developer-docs.amazon.com/sp-api/docs/notifications-api
- ORDER_CHANGE tutorial: https://developer-docs.amazon.com/sp-api/docs/tutorial-subscribe-to-order-change-notification
- Gorgias ecommerce helpdesk/product positioning: https://www.gorgias.com/
- Zendesk service platform reference: https://www.zendesk.com/
- eDesk marketplace/helpdesk reference: https://www.edesk.com/
