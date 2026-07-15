# Amazon Messages - Phase 0.1 Technical Validation

Date: 2026-06-19
Scope: Amazon SP-API Messaging, Notifications, permissions, and viable MVP architecture.
Status: research only. No live Amazon integration implemented.

## Executive Verdict

Amazon SP-API Messaging is safe to treat as an order-linked outbound/reply channel, not as a full Seller Central inbox API.

The official Messaging API exposes operations to:

- get the message actions available for a specific Amazon order;
- send specific buyer messages for that order;
- send invoice/legal/attachment-capable messages where the selected message type supports attachments.

The current official SP-API documentation and model do not expose a general API to read inbound buyer messages, list pending messages, or fetch complete Seller Central conversation threads.

Therefore, the safest product architecture is hybrid:

- SP-API for order lookup, allowed message actions, sending supported messages, invoices/attachments, and order notifications;
- Amazon buyer-message email relay/import for receiving inbound buyer messages if Seller Central inbox parity is required;
- Dashboard as the unified operational console;
- Odoo and Sendcloud remain the sources of truth for order, invoice, and logistics context.

## Capability Matrix

| Requirement | Confirmed status | Notes |
| --- | --- | --- |
| Read incoming buyer messages | Not confirmed / not exposed by Messaging API | No documented Messaging API operation found for listing or reading buyer inbound messages. |
| Read complete conversation threads | Not confirmed / not exposed by Messaging API | Messaging v1 is order/action/send oriented, not thread oriented. |
| Reply/send buyer messages linked to an order | Yes | Use `getMessagingActionsForOrder`, then call the allowed message-type operation. |
| Send messages initiated by seller for an order | Yes, but restricted by message type | Amazon decides available message types per order and marketplace. |
| Attach invoice/PDF | Yes for supported message types | Attachments use Uploads API flow; `sendInvoice` is listed in role mappings. Legal disclosure also supports attachments. |
| Detect pending messages through SP-API | Not confirmed / not exposed | No notification type or Messaging operation found for buyer-message pending count. |
| Receive notification of new buyer message | Not confirmed / not exposed in Notifications API types | Official notification type list includes order/listing/report/etc. events, not buyer-message-created events. |

## Notifications API Finding

Notifications API can subscribe to supported Amazon event types through SQS/EventBridge. It is useful for order and operational events.

For this module, the relevant confirmed type is `ORDER_CHANGE`, which can include order status changes and buyer requested cancellations. It is not a buyer-message notification.

The official notification type list does not currently show a buyer-message/new-inbox-message notification type. So Notifications API should not be designed as the primary trigger for new customer messages.

## Permissions Needed

Minimum likely roles for the MVP:

- Buyer Communication: Messaging API operations such as `getMessagingActionsForOrder`, send message operations, `sendInvoice`.
- Orders role access: one of the allowed order roles depending on actual order operations; for broad order context and tracking, Inventory and Order Tracking is the clean fit, with restricted roles only if PII is required.
- Tokens API: only if restricted data tokens are needed for restricted resources.
- Notifications: subscription operations depend on the role associated with the chosen notification type; `ORDER_CHANGE` maps to Amazon Fulfillment, Direct to Consumer Shipping (Restricted), or Inventory and Order Tracking.

Important: role approval must exist in the developer profile, be selected in the app registration, and may require reauthorization/new refresh token after adding roles.

## Risks

- Amazon may not expose Seller Central inbox parity through SP-API. Building a pure SP-API inbox could become a dead end.
- Messaging actions are order-specific and marketplace-specific; the UI must ask Amazon what is allowed instead of assuming every template/action is available.
- Attachments are not universal. The Dashboard must validate allowed action schemas before enabling invoice/PDF send.
- Email relay ingestion may be necessary for the real inbox, which introduces parsing, deduplication, threading, and privacy/audit requirements.
- Buyer Communication role wording says messaging "to and from" buyers, but the concrete documented Messaging API operations are still send/action oriented. We should trust operation availability over role wording.

## Recommended Viable Architecture

1. Inbound capture layer:
   - Primary: Amazon buyer-message email relay/import into a normalized `amazon_message_threads` model.
   - Optional later: replace or enrich with SP-API only if Amazon exposes a documented read surface for the account.

2. Order context layer:
   - Resolve Amazon order ID to Dashboard/Odoo order.
   - Pull order, invoice, products, status, and customer context from existing Odoo services.
   - Pull tracking and events from Sendcloud services/cache.

3. Response layer:
   - Human writes or approves answer in Dashboard.
   - Before sending, call `getMessagingActionsForOrder`.
   - Enable only actions allowed for that order/marketplace.
   - Use Messaging API/Uploads API for supported outbound messages and attachments.
   - Keep email fallback only if SP-API cannot reply for the specific thread/action.

4. Audit layer:
   - Store inbound source, classification, suggested draft, final human response, sender, timestamps, attachment refs, and Amazon send result.

## First MVP Recommended

Build a non-destructive operational MVP:

- Import/normalize buyer-message emails into Dashboard.
- Match messages to Amazon order IDs and Odoo orders.
- Show unified case screen with Odoo + Sendcloud context.
- Classify cases locally: tracking, invoice, warranty, defect, return, cancellation, other.
- Generate draft responses only; no automatic sending.
- Add a send validation step that checks SP-API Messaging actions for the order.
- Enable SP-API send only for known safe actions after live credential/role validation.

Do not build the final UI around the assumption that SP-API can read the entire Amazon inbox.

## Sources Checked

- Amazon Messaging API: https://developer-docs.amazon.com/sp-api/docs/messaging-api
- Amazon Messaging v1 reference/model: https://developer-docs.amazon.com/sp-api/reference/messaging-v1
- Amazon Messaging model: https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/models/messaging-api-model/messaging.json
- Send a message tutorial: https://developer-docs.amazon.com/sp-api/docs/send-a-message
- Notification type values: https://developer-docs.amazon.com/sp-api/docs/notification-type-values
- Role mappings for operations: https://developer-docs.amazon.com/sp-api/docs/role-mappings
- Role mappings for types: https://developer-docs.amazon.com/sp-api/docs/role-mappings-for-types
- Selling Partner API roles: https://developer-docs.amazon.com/sp-api/docs/roles-in-the-selling-partner-api
- Tokens API: https://developer-docs.amazon.com/sp-api/docs/tokens-api
