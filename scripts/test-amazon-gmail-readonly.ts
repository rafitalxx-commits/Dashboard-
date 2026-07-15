import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncAmazonMessagesFromGmail } from "../backend/amazonMessages/gmailSync.ts";
import { createAmazonMessagesRepository } from "../backend/amazonMessages/repository.ts";
import type { GmailReadonlySource } from "../backend/amazonMessages/gmailClient.ts";
import type { AmazonMessagesActor } from "../backend/amazonMessages/schema.ts";
import {
  resolveOdooOrderContext,
  resolveOdooOrderContextByAmazonOrderId,
} from "../backend/odooOrderContext.ts";

const tempDir = mkdtempSync(join(tmpdir(), "amazon-gmail-readonly-"));
const repository = createAmazonMessagesRepository({
  dataDir: tempDir,
  resolveOrderContext: async (_env, input) =>
    input.amazonOrderId === "301-1111111-2222222" ||
    input.odooOrderId === "S30111"
      ? {
          order: {
            id: "S30111",
            odooRef: "#30111",
            date: "2026-06-20 18:00",
            client: "Cliente Amazon",
            channel: "Amazon DE",
            externalRef: "301-1111111-2222222",
            fulfillmentBy: "FBM",
            sendcloud: {
              reference: "301-1111111-2222222",
              status: "En transito",
              trackingNumber: "SC123456789",
              trackingUrl: "https://tracking.sendcloud.sc/SC123456789",
            },
            deliveryPrinted: false,
            total: 49.9,
            taxTotal: 8.66,
            status: "Confirmado",
            invoiceStatus: "A facturar",
            deliveryStatus: "En transito",
            city: "",
            items: [],
          },
          tracking: {
            carrier: "Sendcloud",
            status: "En transito",
            trackingNumber: "SC123456789",
            trackingUrl: "https://tracking.sendcloud.sc/SC123456789",
            lastEvent: "parcel_in_transit",
            updatedAt: "2026-06-20T16:30:00.000Z",
          },
        }
      : undefined,
});
const actor: AmazonMessagesActor = {
  id: "operator-gmail-test",
  name: "Operator Gmail Test",
  role: "OPERADOR",
};

const rawAmazonEmail = `Message-ID: <gmail-case-1@example.amazon.com>
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
X-Marketplace-ID: A1PA6795UKMFR9
From: "Cliente Amazon" <buyer-gmail@marketplace.amazon.de>
To: Juanito <juanitoopenclaw@gmail.com>
Subject: Paket nicht angekommen(Bestellung: 301-1111111-2222222)
Date: Sat, 20 Jun 2026 18:00:00 +0200
X-Attachments: foto-paquete.jpg|image/jpeg|12345

# 301-1111111-2222222:
1 / Ralerfresh RS [ASIN: B0FIXTURE9]

------------- Message: -------------

Habe mein Paket nicht erhalten

------------- Finalizar mensaje -------------`;

const rawSecondSameOrder = `Message-ID: <gmail-case-2@example.amazon.com>
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
X-Marketplace-ID: A1PA6795UKMFR9
From: "Cliente Amazon" <buyer-gmail@marketplace.amazon.de>
To: Juanito <juanitoopenclaw@gmail.com>
Subject: Re: Paket nicht angekommen(Bestellung: 301-1111111-2222222)
Date: Sat, 20 Jun 2026 18:05:00 +0200

Danke, bitte pruefen Sie die Sendungsnummer.`;

try {
  const missing = await syncAmazonMessagesFromGmail(repository, actor, {
    config: {
      account: "juanitoopenclaw@gmail.com",
      labelName: "AmazonSeller",
      maxMessages: 10,
    },
  });
  assert.equal(missing.ok, false, "missing OAuth should not read Gmail");
  assert.equal(missing.mode, "not_configured");

  const listInputs: Array<Parameters<GmailReadonlySource["listLabelMessages"]>[0]> =
    [];
  const fakeSource: GmailReadonlySource = {
    async listLabelMessages(input) {
      listInputs.push(input);
      return {
        labelId: "Label_AmazonSeller",
        messages: [
          {
            id: "gmail-1",
            threadId: "thread-1",
            historyId: "101",
            rawEmail: rawAmazonEmail,
          },
          {
            id: "gmail-2",
            threadId: "thread-1",
            historyId: "102",
            rawEmail: rawSecondSameOrder,
          },
          {
            id: "gmail-duplicate",
            threadId: "thread-1",
            historyId: "103",
            rawEmail: rawAmazonEmail,
          },
        ],
      };
    },
  };

  const result = await syncAmazonMessagesFromGmail(repository, actor, {
    config: {
      account: "juanitoopenclaw@gmail.com",
      labelName: "AmazonSeller",
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      maxMessages: 10,
    },
    source: fakeSource,
  });

  assert.equal(result.ok, true);
  assert.equal(
    listInputs.at(-1)?.after,
    undefined,
    "manual Gmail sync should rescan the label without lastSyncedAt so newly labelled older messages are imported",
  );
  assert.equal(result.imported, 1, "first Gmail message should create a conversation");
  assert.equal(result.updated, 1, "second same-order message should update conversation");
  assert.equal(result.duplicates, 1, "third message should deduplicate by Message-ID");

  const store = repository.readStoreForTests();
  const conversation = store.conversations.find(
    (item) => item.amazonOrderId === "301-1111111-2222222",
  );
  assert.ok(conversation, "Gmail import should create conversation");
  assert.equal(conversation.messageCount, 2, "same order should group into one conversation");
  assert.equal(
    conversation.odooOrderId,
    "S30111",
    "Gmail import should persist matched Odoo order id",
  );
  assert.equal(conversation.category, "logistics_incident");
  assert.equal(conversation.priority, "high");
  const detail = await repository.getConversation(actor, conversation.conversationId);
  assert.equal(
    detail.context?.tracking?.trackingNumber,
    "SC123456789",
    "conversation detail should include Sendcloud tracking context",
  );

  const importedMessages = store.messages.filter(
    (item) => item.conversationId === conversation.conversationId,
  );
  assert.equal(importedMessages.length, 2, "two non-duplicate messages should persist");
  assert.ok(
    store.attachments.some((item) => item.sanitizedName === "foto-paquete.jpg"),
    "attachment metadata should persist",
  );
  assert.ok(
    store.auditLogs.some((item) => item.eventType === "gmail_message_read"),
    "message read should be audited",
  );
  assert.ok(
    store.auditLogs.some((item) => item.eventType === "gmail_duplicate_ignored"),
    "duplicate should be audited",
  );
  assert.equal(
    store.gmailSync?.importedCount,
    1,
    "importedCount tracks newly created conversations, not total persisted messages",
  );
  assert.equal(
    store.gmailSync?.updatedCount,
    1,
    "updatedCount tracks non-duplicate messages grouped into existing conversations",
  );
  assert.equal(store.gmailSync?.duplicateCount, 1);
  assert.equal(
    store.gmailSync?.errorCount,
    0,
    "OAuth preflight failure is recorded in sync history, not import errorCount",
  );

  const autoResult = await syncAmazonMessagesFromGmail(repository, actor, {
    trigger: "auto",
    config: {
      account: "juanitoopenclaw@gmail.com",
      labelName: "AmazonSeller",
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      maxMessages: 10,
    },
    source: fakeSource,
  });
  assert.equal(autoResult.ok, true);
  assert.ok(
    listInputs.at(-1)?.after,
    "automatic Gmail sync should remain incremental and use lastSyncedAt",
  );

  const originalFetch = globalThis.fetch;
  const odooSearchPayloads: unknown[] = [];
  globalThis.fetch = (async (url, init) => {
    const target = String(url);
    if (target.endsWith("/jsonrpc")) {
      const body = JSON.parse(String(init?.body));
      if (body.params.service === "common") {
        return jsonResponse({ jsonrpc: "2.0", id: body.id, result: 7 });
      }
      odooSearchPayloads.push(body);
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.id,
        result: [
          {
            id: 30111,
            name: "S30111",
            date_order: "2026-06-20 18:00:00",
            partner_id: [44, "Cliente Amazon"],
            team_id: [3, "Amazon DE"],
            amount_total: 49.9,
            amount_tax: 8.66,
            origin: false,
            client_order_ref: "301-1111111-2222222",
            amz_fulfillment_by: "FBM",
            state: "sale",
            invoice_status: "to invoice",
          },
        ],
      });
    }
    if (target.includes("/api/v3/orders")) {
      return jsonResponse({ data: [{ order_number: "301-1111111-2222222" }] });
    }
    if (target.includes("/api/v3/shipments")) {
      return jsonResponse({
        data: [
          {
            order_number: "301-1111111-2222222",
            parcels: [
              {
                status: { code: "parcel_in_transit" },
                tracking_number: "SC123456789",
                tracking_url: "https://tracking.sendcloud.sc/SC123456789",
              },
            ],
          },
        ],
      });
    }
    throw new Error(`Unexpected fetch ${target}`);
  }) as typeof fetch;
  try {
    const resolvedByOdoo = await resolveOdooOrderContext(
      {
        ODOO_URL: "https://odoo.example.test",
        ODOO_DATABASE: "db",
        ODOO_USERNAME: "user",
        ODOO_API_KEY: "key",
        SENDCLOUD_PUBLIC_KEY: "public",
        SENDCLOUD_SECRET_KEY: "secret",
        AMAZON_MESSAGES_DEBUG_SENDCLOUD: "true",
      },
      {
        odooOrderId: "S30111",
        amazonOrderId: "301-1111111-2222222",
      },
    );
    assert.equal(resolvedByOdoo?.order.id, "S30111");
    assert.equal(resolvedByOdoo?.tracking?.carrier, "Sendcloud");
    assert.equal(resolvedByOdoo?.tracking?.trackingNumber, "SC123456789");
    assert.match(
      JSON.stringify(odooSearchPayloads[0]),
      /"name","=","S30111"/,
      "Odoo context should use stored odooOrderId before Amazon fallback",
    );

    const resolved = await resolveOdooOrderContextByAmazonOrderId(
      {
        ODOO_URL: "https://odoo.example.test",
        ODOO_DATABASE: "db",
        ODOO_USERNAME: "user",
        ODOO_API_KEY: "key",
        SENDCLOUD_PUBLIC_KEY: "public",
        SENDCLOUD_SECRET_KEY: "secret",
      },
      "301-1111111-2222222",
    );
    assert.equal(resolved?.order.id, "S30111");
    assert.equal(resolved?.order.externalRef, "301-1111111-2222222");
    assert.equal(resolved?.tracking?.trackingNumber, "SC123456789");
    assert.match(
      JSON.stringify(odooSearchPayloads[1]),
      /client_order_ref/,
      "Odoo lookup should search sale.order.client_order_ref",
    );
    assert.match(
      JSON.stringify(odooSearchPayloads[1]),
      /origin/,
      "Odoo lookup should keep origin fallback",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("Amazon Gmail readonly tests passed.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
