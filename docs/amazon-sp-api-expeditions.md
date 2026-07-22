# Amazon SP-API Expeditions Dry Run

## Official endpoint

Amazon Orders API v0 exposes `confirmShipment`:

- `POST /orders/v0/orders/{orderId}/shipmentConfirmation`
- It confirms shipment status for one Amazon order.
- Default documented usage plan: 2 requests/second, burst 10.
- Required role: Inventory and Order Tracking, or Direct to Consumer Shipping (Restricted).

Amazon documentation also states Ship+ orders do not support `confirmShipment`.

## Current implementation scope

This dashboard implementation is intentionally limited to Expeditions:

- No order import.
- No customer import.
- No message import.
- No legacy fulfillment feed unless later required.
- No real Amazon transmission while dry-run is active.

`DRY_RUN=false` or `AMAZON_SP_API_DRY_RUN=false` is required before live sends are possible.

## Data source

Odoo remains the source of truth. The dashboard resolves the scanned reference to
`sale.order` and `stock.picking`, then prepares the Amazon confirmation from:

- `sale.order.client_order_ref` as the Amazon order ID.
- `sale.order.line.amazon_order_item_id` for Amazon order item IDs.
- Genei shipment details for carrier, tracking, tracking URL, and shipment date.

Shipping-cost lines whose Amazon item ID ends in `_ship` are excluded.

## Storage

The local shipment table is persisted at:

`DASHBOARD_DATA_DIR/amazon-sp-api-shipments.json`

It records:

- picking ID
- sale order ID
- Amazon order ID
- tracking
- carrier
- shipment date
- status
- Amazon request/response
- retries
- created/updated timestamps

## Authentication

The module is prepared for Login with Amazon refresh-token flow using:

- `AMAZON_CLIENT_ID`
- `AMAZON_CLIENT_SECRET`
- `AMAZON_REFRESH_TOKEN`
- `MARKETPLACE_ID`

Amazon announced that AWS IAM/SigV4 is no longer required for SP-API calls from
October 2, 2023, but optional SigV4 support is left behind
`AMAZON_SP_API_USE_AWS_SIGV4=true` with:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`

## Current limitation

The dry-run request is only as complete as the Amazon fields stored by Odoo.
For real sending, confirm that every Amazon order line has `amazon_order_item_id`
and that `MARKETPLACE_ID` matches the store marketplace.
