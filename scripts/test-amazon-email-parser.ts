import assert from "node:assert/strict";
import { parseAmazonEmail } from "../src/modules/amazonMessages/amazonEmailParser.ts";

const cases = [
  {
    name: "buyer seller logistics message",
    raw: `Message-ID: <case-bbc@example.amazon.com>
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
X-Marketplace-ID: A1PA6795UKMFR9
From: "Cliente Amazon" <buyer-logistics@marketplace.amazon.de>
Subject: Paket nicht angekommen: Gutschrift anfordern(Bestellung: 301-0000001-0000001)
Date: Fri, 19 Jun 2026 05:22:00 +0200

# 301-0000001-0000001:
1 / Ralerfresh RS [ASIN: B0FIXTURE1]
Message:
Habe mein Paket nicht erhalten`,
    expected: {
      amazonOrderId: "301-0000001-0000001",
      marketplace: "Amazon DE",
      notificationType: "BBC_MESSAGE_SENT_TO_MERCHANT",
      operationalQueue: "logistics",
      priority: "high",
      asin: "B0FIXTURE1",
      quantity: 1,
      language: "de",
    },
  },
  {
    name: "cancellation request",
    raw: `Message-ID: <case-cancel@example.amazon.com>
X-Space-Notification-Type: BRC_SELLER_NOTIFICATION
X-Marketplace-ID: A1PA6795UKMFR9
From: "Seller Central" <donotreply@amazon.com>
Subject: Solicitud de cancelacion del pedido para el numero de pedido: 303-0000003-0000003
Date: Thu, 18 Jun 2026 21:11:00 +0200

Solicitud de cancelacion del cliente para el numero de pedido: 303-0000003-0000003.`,
    expected: {
      amazonOrderId: "303-0000003-0000003",
      notificationType: "BRC_SELLER_NOTIFICATION",
      operationalQueue: "cancellations",
      priority: "high",
    },
  },
  {
    name: "return request",
    raw: `Message-ID: <case-return@example.amazon.com>
X-Space-Notification-Type: RETURN_REQUEST
X-Marketplace-ID: APJ6JRA9NG5V4
From: "Seller Central" <donotreply@amazon.com>
Subject: Notificacion de autorizacion de devolucion para el pedido 304-0000004-0000004
Date: Fri, 19 Jun 2026 19:38:00 +0200

Identificador de pedido: 304-0000004-0000004
ASIN: B0FIXTURE3
Sku: DEMO-SKU
Cantidad de la devolucion: 2
Motivo de la devolucion: No es el producto que pedi
Comentario del cliente: Servia quello con attacco femmina`,
    expected: {
      amazonOrderId: "304-0000004-0000004",
      marketplace: "Amazon IT",
      notificationType: "RETURN_REQUEST",
      operationalQueue: "returns",
      priority: "high",
      sku: "DEMO-SKU",
      asin: "B0FIXTURE3",
      quantity: 2,
      reason: "No es el producto que pedi",
    },
  },
  {
    name: "a-to-z international return address risk",
    raw: `Message-ID: <case-az@example.amazon.com>
X-Space-Notification-Type: A_Z_CLAIM_RESPONDENT_CLOSE
X-Marketplace-ID: APJ6JRA9NG5V4
From: "atoz-guarantee-no-reply@amazon.com" <atoz-guarantee-no-reply@amazon.com>
Subject: Su reclamacion bajo la Garantia de la A a la Z de Amazon para el pedido 305-0000005-0000005
Date: Fri, 19 Jun 2026 07:20:00 +0200

Hemos concedido una reclamacion bajo la Garantia de la A a la Z de 49,90 EUR en relacion con el pedido 305-0000005-0000005.
Se detecto una direccion de devolucion internacional que incumple la politica local.`,
    expected: {
      amazonOrderId: "305-0000005-0000005",
      notificationType: "A_Z_CLAIM_RESPONDENT_CLOSE",
      operationalQueue: "critical",
      priority: "urgent",
      amount: 49.9,
      isInternationalReturnAddressRisk: true,
    },
  },
] as const;

let assertions = 0;

for (const testCase of cases) {
  const parsed = parseAmazonEmail(testCase.raw, testCase.name);

  for (const [field, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(
      parsed[field as keyof typeof parsed],
      expected,
      `${testCase.name}: expected ${field} to be ${expected}`,
    );
    assertions += 1;
  }
}

const attachmentCases = [
  {
    name: "email with image",
    raw: `Message-ID: <case-image@example.amazon.com>
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
X-Marketplace-ID: A1PA6795UKMFR9
Subject: Foto producto pedido 301-0000010-0000010
X-Attachments: producto-roto.jpg|image/jpeg|204800

Attachment: producto-roto.jpg|image/jpeg|204800`,
    expectedCount: 1,
    expected: {
      sanitizedName: "producto-roto.jpg",
      mimeType: "image/jpeg",
      isImage: true,
      isPdf: false,
      allowed: true,
      previewable: true,
    },
  },
  {
    name: "email with pdf",
    raw: `Message-ID: <case-pdf@example.amazon.com>
X-Space-Notification-Type: RETURN_REQUEST
X-Marketplace-ID: APJ6JRA9NG5V4
Subject: Documento pedido 304-0000011-0000011
X-Attachments: documento.pdf|application/pdf|409600

Solicitud con PDF.`,
    expectedCount: 1,
    expected: {
      sanitizedName: "documento.pdf",
      mimeType: "application/pdf",
      isImage: false,
      isPdf: true,
      allowed: true,
      previewable: true,
    },
  },
  {
    name: "email without attachments",
    raw: `Message-ID: <case-no-attachment@example.amazon.com>
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
Subject: Pedido 301-0000012-0000012

Sin adjuntos.`,
    expectedCount: 0,
  },
  {
    name: "duplicate attachment",
    raw: `Message-ID: <case-duplicate@example.amazon.com>
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
Subject: Pedido 301-0000013-0000013
X-Attachments: foto.png|image/png|1000, foto.png|image/png|1000

Attachment: foto.png|image/png|1000`,
    expectedCount: 1,
    expected: {
      sanitizedName: "foto.png",
      hash: "defined",
    },
  },
  {
    name: "dangerous filename",
    raw: `Message-ID: <case-dangerous@example.amazon.com>
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
Subject: Pedido 301-0000014-0000014
X-Attachments: ../../factura.html|text/html|1200

Adjunto peligroso.`,
    expectedCount: 1,
    expected: {
      sanitizedName: "-..-factura.html",
      allowed: false,
      kind: "blocked",
    },
  },
  {
    name: "common unknown format",
    raw: `Message-ID: <case-other@example.amazon.com>
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
Subject: Pedido 301-0000015-0000015
X-Attachments: datos.xml|application/octet-stream|1200

Formato no previsualizable.`,
    expectedCount: 1,
    expected: {
      mimeType: "application/octet-stream",
      kind: "other",
      previewable: false,
      downloadable: true,
    },
  },
] as const;

for (const testCase of attachmentCases) {
  const parsed = parseAmazonEmail(testCase.raw, testCase.name);
  assert.equal(
    parsed.attachments.length,
    testCase.expectedCount,
    `${testCase.name}: unexpected attachment count`,
  );
  assertions += 1;

  if (testCase.expected && parsed.attachments[0]) {
    for (const [field, expected] of Object.entries(testCase.expected)) {
      if (expected === "defined") {
        assert.ok(
          parsed.attachments[0][field as keyof typeof parsed.attachments[0]],
          `${testCase.name}: expected ${field} to be defined`,
        );
      } else {
        assert.deepEqual(
          parsed.attachments[0][field as keyof typeof parsed.attachments[0]],
          expected,
          `${testCase.name}: expected attachment ${field} to be ${expected}`,
        );
      }
      assertions += 1;
    }
  }
}

console.log(
  `Amazon email parser tests passed: ${cases.length + attachmentCases.length} fixtures, ${assertions} field checks.`,
);
