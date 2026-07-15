# Amazon Messages - Product and Architecture Plan

Version: 1.0
Date: June 2026
Owner: Juanito
Scope: Dashboard TodoElectrico

## Product Intent

Amazon Messages must become the first customer-service operations module inside the Dashboard, not just an inbox. The operator should be able to understand and resolve an Amazon customer case from one screen: buyer message, related Odoo order, invoice state, delivery/tracking context, previous history, internal notes, suggested response, and final audit.

The module must preserve the current sources of truth:

- Orders: Odoo.
- Invoices: Odoo.
- Logistics and tracking status: Sendcloud.
- Amazon buyer communication: Amazon.
- Dashboard: operational surface, permissions, audit, enrichment, and workflow.

## Existing Dashboard Architecture Observed

- Frontend is React + Vite.
- Main UI is concentrated in `src/App.tsx`.
- Frontend API wrapper is `src/services/odooClient.ts`.
- Shared frontend types are in `src/services/odooTypes.ts`.
- Current backend routes are implemented as Vite middleware in `vite.config.ts`.
- Existing auth/permissions cover dashboard sections and Odoo write actions.
- Existing Odoo reads already cover `sale.order`, `sale.order.line`, `stock.picking`, `stock.move`, `account.move`, `res.partner`, product images, and BOM context.
- Existing Sendcloud integration enriches order rows with status, tracking number, tracking URL, and a 5 minute in-memory cache.
- The current order shape already has several fields Amazon Messages will need: `externalRef`, `channel`, `fulfillmentBy`, `sendcloud`, invoice status, delivery status, products, shipping address, and phone.

## External Product Lessons

Reference products reviewed conceptually:

- Gorgias: conversation-first ticket view, customer/order context beside the thread, AI summaries and handoff context.
- eDesk: marketplace-native central inbox, Amazon channel linkage, order/messages/delivery/returns/refund context flowing into one workspace.
- Zendesk/Freshdesk: mature queue management, assignment, SLA, tags, views, macros, audit trail, and reporting.

Adapted principle for TodoElectrico: the interface should be dense and operational, not decorative. The strongest pattern is a three-panel workspace: queue, conversation, operational context.

## Critical Amazon SP-API Constraint

Amazon SP-API Messaging v1 is primarily documented for sending buyer messages by order and message type. It supports fetching available message actions for an order and sending a selected message type. The official workflow is order-first and send-oriented, not a guaranteed full Seller Central inbox mirror.

Notifications API can push relevant business events through SQS/EventBridge and must have a backup retrieval mechanism. Tokens API is required for restricted PII operations such as buyer/order PII.

Before implementing a live inbox, Phase 0 must validate exactly which Amazon message read surfaces are available to the seller account and app roles. If Amazon does not expose inbound Buyer-Seller message bodies through SP-API for our account, the product must either:

- start with order-linked outbound/suggested messaging plus incoming notification metadata, or
- explicitly approve an alternative compliant ingestion path before it becomes a production dependency.

No scraping should be used.

## Recommended Module Architecture

Do not expand `App.tsx` and `vite.config.ts` with the full module. Add a separate module boundary:

- `src/modules/amazonMessages/`
  - `AmazonMessagesView.tsx`
  - `AmazonConversationView.tsx`
  - `AmazonMessagesInbox.tsx`
  - `AmazonMessageContextPanel.tsx`
  - `amazonMessagesTypes.ts`
  - `amazonMessagesClient.ts`
  - `amazonMessagesDemoData.ts`
- `src/services/customerSupportTypes.ts`
  - Future-safe shared types for Amazon, Prestashop, Leroy Merlin, ManoMano, email, WhatsApp, Telegram, and web chat.
- Server-side module, preferably separated from `vite.config.ts`:
  - `server/amazon/spApiClient.ts`
  - `server/amazon/messagesRepository.ts`
  - `server/amazon/classifier.ts`
  - `server/amazon/auditRepository.ts`
  - `server/amazon/knowledgeBaseRepository.ts`

Short term, Vite middleware can route `/api/amazon/*` while the server code lives in separate files.

## Permissions

Add focused permissions instead of reusing broad settings:

- `amazonMessagesRead`
- `amazonMessagesReply`
- `amazonMessagesManage`
- `amazonMessagesAi`

Sending to Amazon must require `amazonMessagesReply`. AI draft generation can be enabled separately.

## Data Model

Store only workflow state, audit, and lightweight metadata needed by the Dashboard. Do not duplicate Odoo or Sendcloud state.

Suggested local entities:

- `support_conversation`
  - `id`
  - `channel` (`amazon`)
  - `marketplaceId`
  - `amazonOrderId`
  - `odooOrderId`
  - `customerDisplayName`
  - `lastMessageAt`
  - `status`
  - `category`
  - `priority`
  - `assignedUserId`
  - `unread`
  - `createdAt`
  - `updatedAt`
- `support_message`
  - `id`
  - `conversationId`
  - `direction`
  - `externalMessageId`
  - `body`
  - `attachments`
  - `sentByUserId`
  - `createdAt`
- `support_ai_draft`
  - `id`
  - `conversationId`
  - `category`
  - `promptContextHash`
  - `draftBody`
  - `sourceDataSnapshot`
  - `createdBy`
  - `createdAt`
  - `acceptedAt`
  - `rejectedAt`
- `support_audit_event`
  - `id`
  - `conversationId`
  - `userId`
  - `eventType`
  - `before`
  - `after`
  - `createdAt`
- `support_template`
  - `id`
  - `category`
  - `title`
  - `body`
  - `variables`
  - `active`

For Phase 1 this can be file-backed JSON like current auth/tasks if we keep scope small, but production should move to SQLite/Postgres before messages become operationally critical.

## API Surface

Dashboard API:

- `GET /api/amazon/messages`
  - inbox list with filters, pagination, assignment, status, category, priority.
- `GET /api/amazon/messages/:conversationId`
  - conversation thread plus enriched context.
- `POST /api/amazon/messages/:conversationId/draft`
  - classify and generate suggested reply. Does not send.
- `POST /api/amazon/messages/:conversationId/send`
  - sends validated operator reply through SP-API if available.
- `PATCH /api/amazon/messages/:conversationId`
  - status, assignment, category, priority.
- `GET /api/amazon/config`
  - marketplace/config health without secrets.
- `POST /api/amazon/webhooks/notifications`
  - future notification receiver if using a push workflow.

Context enrichment should call existing Odoo and Sendcloud helpers by order reference, not copy their data into message storage.

## UX Plan

Navigation:

- Add "Amazon Messages" to the sidebar.
- Subviews: Inbox, Pendientes, Respondidos, Garantias, Facturas, Logistica, Configuracion.

Inbox table:

- Priority
- Marketplace
- Customer
- Order
- Category
- Last message
- Date
- Status
- Owner
- Quick actions

Conversation workspace:

- Left: buyer, marketplace, previous conversations, previous orders.
- Center: chat-style conversation, attachments, reply editor, AI draft block.
- Right: Odoo order, products, invoice, Sendcloud status/tracking, internal notes, audit.

Operational rule: the right panel must answer "what do I need to know before replying?" without leaving the screen.

## Classification

Initial categories:

- Where is my order
- Delay
- Warranty
- Invoice
- Defective product
- Return
- Technical question
- Cancellation
- Logistics incident
- Other

Phase 1 can start with deterministic keyword/rule classification and manual override. Phase 2 can add AI classification and confidence.

## AI Rules

- AI never sends automatically.
- AI drafts must include the data used to generate the answer.
- Operator must validate before send.
- Store proposed draft, final answer, and changes for audit.
- If order/tracking/invoice data is missing or ambiguous, the AI must say it cannot safely answer and request operator review.

## Priority Use Cases

1. Where is my order?
   - Match Amazon order to Odoo via `externalRef`/client order ref.
   - Read Odoo delivery/invoice state.
   - Read Sendcloud tracking/status/events.
   - Draft a concise customer reply with carrier, tracking, and current status.
   - Wait for operator send.

2. Defective product.
   - Show purchase date, products, previous issues, and guarantee context.
   - Draft next-step response without promising replacement/refund automatically.

3. Invoice request.
   - Match Odoo invoice.
   - Show PDF availability.
   - Allow immediate send only after operator confirms.

## Implementation Phases

Phase 0 - validation and architecture:

- Confirm Amazon SP-API app roles and account permissions.
- Validate whether inbound Buyer-Seller messages are readable for this account.
- Validate message send operations in sandbox or with a controlled test order.
- Decide storage backend for support workflow state.
- Finalize UI wireframe.

Phase 1 - read/view foundation:

- Add module shell and navigation.
- Add demo inbox and conversation view.
- Add order-context enrichment from existing Odoo/Sendcloud helpers.
- Add manual categories, statuses, and assignment.
- Add audit events for internal state changes.

Phase 2 - classification and drafts:

- Add deterministic classification.
- Add AI draft generation with explicit no-auto-send guard.
- Add template variables.
- Add draft/final answer audit.

Phase 3 - knowledge base and templates:

- Add editable templates.
- Add category-specific knowledge snippets.
- Add suggested template selection.

Phase 4 - partial automation:

- Auto-prioritize, auto-classify, auto-assign.
- Prepare one-click safe actions.
- Keep irreversible actions human-approved.

Phase 5 - omnichannel support center:

- Generalize the model to other marketplaces and channels.
- Add KPIs and SLA dashboards.
- Add cross-channel customer history.

## Risks

- Amazon may not expose full inbound message body reading through SP-API for this account.
- Buyer PII and restricted data require Tokens API/RDT handling and stricter retention controls.
- Current backend-in-Vite shape is convenient but not ideal for a customer-support module with credentials, audit, and notifications.
- Current local JSON storage is acceptable for config/tasks but risky for operational messages unless backed up and locked carefully.
- Sendcloud cache currently shows summary status/tracking, but conversation resolution may need richer event history.
- Odoo invoice PDF access must be validated separately; invoice metadata is already available but PDF serving may need a new endpoint.

## Recommended First Build Slice

Build a non-destructive Amazon Messages shell first:

1. New sidebar menu and route.
2. Inbox with demo/local messages.
3. Conversation screen with real Odoo/Sendcloud context when an Amazon order id matches an existing Odoo `externalRef`.
4. Manual category/status/assignment.
5. No Amazon send and no live Amazon ingestion until Phase 0 validation is complete.

This gives the team a real UI to evaluate while keeping the irreversible Amazon integration safely gated.

