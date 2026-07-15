import type { Order } from "../../services/odooTypes";
import {
  deduplicateParsedEmails,
  parseAmazonEmail,
} from "./amazonEmailParser";
import type {
  AmazonAuditEvent,
  AmazonAiDraft,
  AmazonConversation,
  AmazonConversationContext,
  AmazonConversationPriority,
  AmazonConversationStatus,
  AmazonKnowledgeEntry,
  AmazonLogisticsStats,
  AmazonMessageCategory,
  AmazonOperatorStats,
  AmazonProductStats,
  AmazonSmartAlert,
  AmazonStatsSummary,
  AmazonSupportBotCapability,
  AmazonSupportMessage,
  AmazonTemplate,
  ParsedAmazonEmail,
} from "./amazonMessagesTypes";

const rawDemoEmails = [
  `Message-ID: <fixture-bbc-logistics-1@example.amazon.com>
X-Dashboard-Demo-UID: fixture-bbc-logistics-1
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
X-Marketplace-ID: A1PA6795UKMFR9
From: "Cliente Amazon" <buyer-logistics-1@marketplace.amazon.de>
To: TodoElectrico <amazon-messages@todoelectrico.net>
Subject: Paket nicht angekommen: Gutschrift anfordern(Bestellung: 301-0000001-0000001)
Date: Fri, 19 Jun 2026 05:22:00 +0200
X-Attachments: foto-paquete-demo.jpg|image/jpeg|184320

Ha recibido un mensaje.

# 301-0000001-0000001:
1 / Organisches Kaeltemittel Ralerfresh RS [ASIN: B0FIXTURE1]

------------- Message: -------------

Habe mein Paket nicht erhalten

------------- Finalizar mensaje -------------`,
  `Message-ID: <fixture-bbc-logistics-2@example.amazon.com>
X-Dashboard-Demo-UID: fixture-bbc-logistics-2
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
X-Marketplace-ID: A1PA6795UKMFR9
From: "Cliente Amazon" <buyer-logistics-2@marketplace.amazon.de>
To: TodoElectrico <amazon-messages@todoelectrico.net>
Subject: Frage von Amazon-Kunde True (Bestellung: 302-0000002-0000002)
Date: Wed, 17 Jun 2026 16:33:00 +0200

# 302-0000002-0000002:
1 / Organisches Kuehlgas Ralerfresh RS [ASIN: B0FIXTURE2]

------------- Message: -------------

Guten Tag
In diesem Fall bitten wir um Nachlieferung.
Bitte teilen Sie uns dann die Sendungsnummer der Nachsendung mit.

------------- Finalizar mensaje -------------`,
  `Message-ID: <fixture-cancel-1@example.amazon.com>
X-Dashboard-Demo-UID: fixture-cancel-1
X-Space-Notification-Type: BRC_SELLER_NOTIFICATION
X-Marketplace-ID: A1PA6795UKMFR9
From: "Notificaciones de Seller Central" <donotreply@amazon.com>
To: TodoElectrico <amazon-messages@todoelectrico.net>
Subject: Solicitud de cancelacion del pedido para el numero de pedido: 303-0000003-0000003
Date: Thu, 18 Jun 2026 21:11:00 +0200

Hola:
Has recibido una solicitud de cancelacion de pedido de un cliente.
Solicitud de cancelacion del cliente para el numero de pedido: 303-0000003-0000003.`,
  `Message-ID: <fixture-return-1@example.amazon.com>
X-Dashboard-Demo-UID: fixture-return-1
X-Space-Notification-Type: RETURN_REQUEST
X-Marketplace-ID: APJ6JRA9NG5V4
From: "Comunicaciones de Seller Central" <donotreply@amazon.com>
To: TodoElectrico <amazon-messages@todoelectrico.net>
Subject: Notificacion de autorizacion de devolucion para el pedido 304-0000004-0000004
Date: Fri, 19 Jun 2026 19:38:00 +0200
X-Attachments: solicitud-devolucion-demo.pdf|application/pdf|245760

Identificador de pedido: 304-0000004-0000004
Fecha de la solicitud de devolucion: 2026-06-19
Autorizacion: Autorizado automaticamente por Amazon
Producto del pedido: Ralerfresh RS recarga de gas
ASIN: B0FIXTURE3
Sku: DEMO-SKU
Cantidad de la devolucion: 2
Motivo de la devolucion: No es el producto que pedi
Comentario del cliente: Servia quello con attacco femmina`,
  `Message-ID: <fixture-az-1@example.amazon.com>
X-Dashboard-Demo-UID: fixture-az-1
X-Space-Notification-Type: A_Z_CLAIM_RESPONDENT_CLOSE
X-Marketplace-ID: APJ6JRA9NG5V4
From: "atoz-guarantee-no-reply@amazon.com" <atoz-guarantee-no-reply@amazon.com>
To: TodoElectrico <amazon-messages@todoelectrico.net>
Subject: Su reclamacion bajo la Garantia de la A a la Z de Amazon para el pedido 305-0000005-0000005
Date: Fri, 19 Jun 2026 07:20:00 +0200

Hola, Todoelectrico:
Hemos concedido una reclamacion bajo la Garantia de la A a la Z de 49,90 EUR en relacion con el pedido 305-0000005-0000005.
Hemos cobrado el importe de su cuenta y la reclamacion se contabilizara en su ratio de pedidos defectuosos ODR.
En este caso, hemos detectado que ha autorizado la solicitud de devolucion de este pedido con una direccion de devolucion internacional, lo que incumple la politica local de devoluciones de Amazon.`,
  `Message-ID: <fixture-invoice-1@example.amazon.com>
X-Dashboard-Demo-UID: fixture-invoice-1
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
X-Marketplace-ID: A1PA6795UKMFR9
From: "Cliente Amazon" <buyer-invoice@marketplace.amazon.de>
To: TodoElectrico <amazon-messages@todoelectrico.net>
Subject: Rechnung fuer Bestellung 306-0000006-0000006
Date: Fri, 19 Jun 2026 09:18:00 +0200

Hallo,
ich brauche die Rechnung fuer Bestellung 306-0000006-0000006.
Danke.`,
  `Message-ID: <fixture-unknown-1@example.amazon.com>
X-Dashboard-Demo-UID: fixture-unknown-1
From: "Amazon Buyer" <buyer-unknown@marketplace.amazon.es>
To: TodoElectrico <amazon-messages@todoelectrico.net>
Subject: Consulta tecnica Amazon ES
Date: Fri, 19 Jun 2026 11:22:00 +0200

Hola, queria saber si este producto es compatible con una instalacion sin neutro.`,
] as const;

export function buildAmazonDemoConversations(orders: Order[]): AmazonConversation[] {
  const demoReadyOrders = addDemoAmazonReferences(orders);
  const parsed = rawDemoEmails.map((email, index) =>
    parseAmazonEmail(email, `manual-${index + 1}`),
  );
  const { unique, duplicates } = deduplicateParsedEmails(parsed);
  const conversations = unique.map((email, index) =>
    buildConversation(email, demoReadyOrders, index),
  );
  const firstConversation = conversations[0];

  if (firstConversation && duplicates.length > 0) {
    firstConversation.audit.push(
      ...duplicates.map((duplicate, index) => ({
        id: `audit-dedupe-${index + 1}`,
        conversationId: firstConversation.id,
        eventType: "deduplicated" as const,
        label: `Duplicado omitido por ${duplicate.reason}: ${duplicate.messageId}`,
        actor: "Sistema",
        createdAt: new Date("2026-06-19T08:44:00+02:00").toISOString(),
      })),
    );
  }

  return conversations.sort(
    (left, right) =>
      new Date(right.lastMessageAt).getTime() -
      new Date(left.lastMessageAt).getTime(),
  );
}

function addDemoAmazonReferences(orders: Order[]) {
  const demoRefs = [
    {
      externalRef: "301-0000001-0000001",
      sendcloud: {
        reference: "301-0000001-0000001",
        status: "En transito",
        rawStatus: "El envio ha salido del centro logistico",
        trackingNumber: "SCDEMO2145961",
        trackingUrl: "https://tracking.sendcloud.sc/demo/SCDEMO2145961",
      },
    },
    {
      externalRef: "306-0000006-0000006",
      sendcloud: {
        reference: "306-0000006-0000006",
        status: "Entregado",
        rawStatus: "Entregado al destinatario",
        trackingNumber: "SCDEMO7654321",
        trackingUrl: "https://tracking.sendcloud.sc/demo/SCDEMO7654321",
      },
    },
    {
      externalRef: "303-0000003-0000003",
      sendcloud: {
        reference: "303-0000003-0000003",
        status: "Pendiente de preparar",
        rawStatus: "Pedido aun no confirmado como enviado",
      },
    },
  ];

  return orders.map((order, index) => {
    const demoRef = demoRefs[index];
    if (!demoRef || order.externalRef) return order;
    return {
      ...order,
      channel: order.channel === "Odoo" ? "Amazon FBM" : order.channel,
      externalRef: demoRef.externalRef,
      sendcloud: order.sendcloud ?? demoRef.sendcloud,
    };
  });
}

function buildConversation(
  email: ParsedAmazonEmail,
  orders: Order[],
  index: number,
) {
  const order = findOrder(email, orders);
  const category = classifyEmail(email);
  const context = buildContext(order, category);
  const priority = prioritize(email.priority, category, context);
  const id = `amz-conv-${index + 1}`;
  const message = buildMessage(email, id);
  const audit = buildAudit(id, email, category, Boolean(order));
  const draft: AmazonAiDraft = {
    id: `draft-${id}`,
    conversationId: id,
    category,
    confidence: order ? 0.82 : 0.58,
    body: draftReply(email, category, context),
    status: "suggested" as const,
    generatedAt: new Date(
      new Date(email.receivedAt).getTime() + 7 * 60 * 1000,
    ).toISOString(),
    templateId: suggestedTemplateId(category),
    templateName: suggestedTemplateName(category),
    consultedKnowledgeIds: index < 3 ? [`kb-demo-${index + 1}`] : [],
    suggestionMode: suggestedTemplateId(category)
      ? "approved_template"
      : index < 3
        ? "approved_examples"
        : "free_generation",
  };

  return {
    id,
    marketplace: email.marketplace ?? "Amazon ES",
    amazonOrderId: email.amazonOrderId,
    odooOrderId: order?.id,
    customerDisplayName: email.buyerAlias ? "Cliente Amazon" : "Cliente sin alias",
    buyerAliasHash: email.buyerAlias ? hashAlias(email.buyerAlias) : "sin-alias",
    subject: email.subject,
    status: statusForCategory(category),
    category,
    notificationType: email.notificationType,
    operationalQueue: email.operationalQueue,
    recommendedAction: email.recommendedAction,
    extracted: {
      language: email.language,
      sku: email.sku,
      asin: email.asin,
      quantity: email.quantity,
      amount: email.amount,
      currency: email.currency,
      reason: email.reason,
      operationalStatus: email.operationalStatus,
      customerComment: email.customerComment,
      isInternationalReturnAddressRisk: email.isInternationalReturnAddressRisk,
    },
    priority,
    assignedUser: priority === "urgent" || priority === "high" ? "Soporte" : "Sin asignar",
    respondingUser: priority === "urgent" ? "Rafa" : "Soporte",
    validatingUser: priority === "urgent" || category === "a_to_z" ? "Rafa" : "Soporte",
    timeSpentMinutes: category === "a_to_z" ? 38 : category === "technical" ? 16 : 9 + index * 3,
    unreadCount: 1,
    lastMessageAt: email.receivedAt,
    matchConfidence: order ? "exact" : email.amazonOrderId ? "unmatched" : "weak",
    messages: [message],
    draft,
    audit,
    context,
  } satisfies AmazonConversation;
}

export function buildAmazonKnowledgeEntries(
  conversations: AmazonConversation[],
): AmazonKnowledgeEntry[] {
  return conversations.slice(0, 5).map((conversation, index) => ({
    id: `kb-demo-${index + 1}`,
    category: conversation.category,
    marketplace: conversation.marketplace,
    language: conversation.extracted.language ?? "es",
    date: conversation.lastMessageAt,
    originalCustomerMessage:
      conversation.messages[0]?.bodyText.slice(0, 360) ?? "Mensaje demo sanitizado",
    classification: conversation.recommendedAction,
    templateId: conversation.draft?.templateId,
    templateName: conversation.draft?.templateName,
    initialDraft: conversation.draft?.body ?? "",
    aiDraft: conversation.draft?.body ?? "",
    finalResponse: finalApprovedResponse(conversation),
    approver: conversation.validatingUser ?? "Soporte",
    quality: index === 3 ? "medium" : "high",
    confidence: conversation.draft?.confidence ?? 0.8,
    tags: knowledgeTags(conversation.category),
    sku: conversation.extracted.sku,
    amazonOrderId: conversation.amazonOrderId,
    status: index === 4 ? "archived" : "active",
    useAsApprovedExample: index !== 4,
    anonymized: true,
    approvedAt: conversation.lastMessageAt,
    draftDiff:
      index % 2 === 0
        ? "El operador concreto el siguiente paso y elimino informacion insegura."
        : "Respuesta aceptada con cambios menores de tono.",
    humanDiffSummary:
      index % 2 === 0
        ? "El operador concreto el siguiente paso y elimino informacion insegura."
        : "Respuesta aceptada con cambios menores de tono.",
  }));
}

export function buildAmazonTemplates(): AmazonTemplate[] {
  return [
    template("tpl-tracking", "Donde esta mi pedido", "tracking", "Amazon DE", "de", [
      "{cliente}",
      "{amazon_order_id}",
      "{tracking}",
      "{tracking_url}",
      "{transportista}",
    ]),
    template("tpl-not-received", "Pedido no recibido", "not_received", "Amazon DE", "de", [
      "{amazon_order_id}",
      "{tracking}",
      "{transportista}",
      "{marketplace}",
    ]),
    template("tpl-delay", "Entrega retrasada", "delay", "Amazon ES", "es", [
      "{amazon_order_id}",
      "{fecha_entrega}",
      "{transportista}",
    ]),
    template("tpl-return", "Devolucion", "return", "Amazon IT", "it", [
      "{amazon_order_id}",
      "{producto}",
      "{marketplace}",
    ]),
    template("tpl-defect", "Producto defectuoso", "defect", "Amazon ES", "es", [
      "{producto}",
      "{amazon_order_id}",
    ]),
    template("tpl-wrong-product", "Producto incorrecto", "wrong_product", "Amazon ES", "es", [
      "{producto}",
      "{amazon_order_id}",
    ]),
    template("tpl-warranty", "Garantia", "warranty", "Amazon ES", "es", [
      "{producto}",
      "{amazon_order_id}",
    ]),
    template("tpl-invoice", "Factura", "invoice", "Amazon DE", "de", [
      "{amazon_order_id}",
      "{odoo_order}",
    ]),
    template("tpl-cancel", "Cancelacion", "cancellation", "Amazon DE", "de", [
      "{amazon_order_id}",
      "{fecha_envio}",
    ]),
    template("tpl-technical", "Consulta tecnica", "technical", "Amazon ES", "es", [
      "{producto}",
      "{marketplace}",
    ]),
    template("tpl-az", "A-to-Z", "a_to_z", "Amazon IT", "es", [
      "{amazon_order_id}",
      "{marketplace}",
    ]),
    template("tpl-refund", "Reembolso", "refund", "Amazon ES", "es", [
      "{amazon_order_id}",
      "{marketplace}",
    ]),
  ];
}

export function buildAmazonStatsSummary(
  conversations: AmazonConversation[],
  templates: AmazonTemplate[],
): AmazonStatsSummary {
  const closedCases = conversations.filter((item) => item.status === "resolved").length;
  const openCases = conversations.length - closedCases;
  const aiUses = conversations.filter((item) => item.draft).length;
  const templateUses = templates.reduce((sum, item) => sum + item.usageCount, 0);

  return {
    totalMessages: conversations.reduce((sum, item) => sum + item.messages.length, 0),
    byCategory: countRows(conversations.map((item) => item.category)),
    byMarketplace: countRows(conversations.map((item) => item.marketplace)),
    byLanguage: countRows(conversations.map((item) => item.extracted.language ?? "sin detectar")),
    byPriority: countRows(conversations.map((item) => item.priority)),
    byStatus: countRows(conversations.map((item) => item.status)),
    kpis: {
      averageResponseMinutes: Math.round(
        conversations.reduce((sum, item) => sum + item.timeSpentMinutes, 0) /
          Math.max(conversations.length, 1),
      ),
      averageResolutionHours: 14,
      openCases,
      closedCases,
      criticalCases: conversations.filter((item) => item.priority === "urgent").length,
      templateUses,
      aiUses,
      humanCorrections: conversations.filter((item) => item.draft?.status === "edited").length + 3,
      acceptedWithoutChanges: 2,
      modifiedResponses: 4,
      discardedResponses: 1,
    },
  };
}

export function buildAmazonOperatorStats(
  conversations: AmazonConversation[],
): AmazonOperatorStats[] {
  const operators = ["Soporte", "Rafa", "Operaciones"];
  return operators.map((operator) => {
    const assigned = conversations.filter((item) => item.assignedUser === operator).length;
    const responded = conversations.filter((item) => item.respondingUser === operator).length;
    const validated = conversations.filter((item) => item.validatingUser === operator).length;
    const related = conversations.filter(
      (item) =>
        item.assignedUser === operator ||
        item.respondingUser === operator ||
        item.validatingUser === operator,
    );
    return {
      operator,
      assigned,
      responded,
      validated,
      timeSpentMinutes: related.reduce((sum, item) => sum + item.timeSpentMinutes, 0),
      closedCases: related.filter((item) => item.status === "resolved").length,
      pendingCases: related.filter((item) => item.status !== "resolved").length,
      templateUses: related.filter((item) => item.draft?.templateId).length,
      aiUses: related.filter((item) => item.draft).length,
      corrections: related.filter((item) => item.draft?.status === "edited").length + (operator === "Rafa" ? 2 : 1),
      averageResponseMinutes: related.length
        ? Math.round(
            related.reduce((sum, item) => sum + item.timeSpentMinutes, 0) / related.length,
          )
        : 0,
    };
  });
}

export function buildAmazonProductStats(
  conversations: AmazonConversation[],
): AmazonProductStats[] {
  const keyed = new Map<string, AmazonProductStats>();
  for (const conversation of conversations) {
    const sku = conversation.extracted.sku ?? conversation.extracted.asin ?? "SKU pendiente";
    const current =
      keyed.get(sku) ??
      {
        sku,
        asin: conversation.extracted.asin,
        incidents: 0,
        returns: 0,
        technicalQuestions: 0,
        claims: 0,
        aToZ: 0,
      };
    current.incidents += 1;
    if (conversation.category === "return") current.returns += 1;
    if (conversation.category === "technical") current.technicalQuestions += 1;
    if (conversation.category === "a_to_z") {
      current.claims += 1;
      current.aToZ += 1;
    }
    keyed.set(sku, current);
  }
  return Array.from(keyed.values()).sort((left, right) => right.incidents - left.incidents);
}

export function buildAmazonLogisticsStats(
  conversations: AmazonConversation[],
): AmazonLogisticsStats[] {
  const logistics = conversations.filter(
    (item) =>
      item.operationalQueue === "logistics" ||
      item.category === "tracking" ||
      item.category === "logistics_incident" ||
      item.category === "not_received",
  );
  return [
    {
      carrier: "Sendcloud",
      incidents: logistics.length,
      delays: conversations.filter((item) => item.category === "delay").length + 1,
      notReceived: conversations.filter((item) =>
        /nicht erhalten|no recibido|not received/i.test(item.messages[0]?.bodyText ?? ""),
      ).length,
      deliveryProblems: logistics.length + 1,
      country: "DE",
    },
    {
      carrier: "Pendiente de validar",
      incidents: conversations.filter((item) => !item.context.tracking?.trackingNumber).length,
      delays: 1,
      notReceived: 1,
      deliveryProblems: 2,
      country: "ES/IT",
    },
  ];
}

export function buildAmazonSmartAlerts(
  conversations: AmazonConversation[],
  products: AmazonProductStats[],
  logistics: AmazonLogisticsStats[],
): AmazonSmartAlert[] {
  const alerts: AmazonSmartAlert[] = [];
  const critical = conversations.filter((item) => item.operationalQueue === "critical").length;
  if (critical > 0) {
    alerts.push({
      id: "alert-az",
      title: "A-to-Z abierto",
      detail: `${critical} caso critico requiere revision manual antes de responder.`,
      severity: "critical",
      metric: "a_to_z_open",
      createdAt: new Date("2026-06-20T16:45:00+02:00").toISOString(),
    });
  }
  const topProduct = products[0];
  if (topProduct && topProduct.incidents >= 2) {
    alerts.push({
      id: "alert-product",
      title: "SKU con incidencias repetidas",
      detail: `${topProduct.sku} concentra ${topProduct.incidents} incidencias en los fixtures.`,
      severity: "warning",
      metric: "sku_incidents",
      createdAt: new Date("2026-06-20T16:46:00+02:00").toISOString(),
    });
  }
  const topCarrier = logistics[0];
  if (topCarrier && topCarrier.deliveryProblems > 1) {
    alerts.push({
      id: "alert-logistics",
      title: "Incidencias logisticas en aumento",
      detail: `${topCarrier.carrier} acumula ${topCarrier.deliveryProblems} problemas de entrega demo.`,
      severity: "warning",
      metric: "carrier_delivery_problems",
      createdAt: new Date("2026-06-20T16:47:00+02:00").toISOString(),
    });
  }
  return alerts;
}

export function buildAmazonSupportBotCapabilities(): AmazonSupportBotCapability[] {
  return [
    capability("Cuantos mensajes hay pendientes", "Conversaciones pendientes", "/amazon-messages/conversations/pending"),
    capability("Cuantas devoluciones hay esta semana", "Stats por categoria", "/amazon-messages/stats/categories"),
    capability("Cuantas A-to-Z abiertas hay", "Conversaciones criticas", "/amazon-messages/conversations/critical"),
    capability("Que operador tiene mas pendientes", "Stats por operador", "/amazon-messages/stats/operators"),
    capability("Que productos tienen mas incidencias", "Stats por producto", "/amazon-messages/stats/products"),
    capability("Que transportistas generan mas problemas", "Stats logisticas", "/amazon-messages/stats/summary"),
    capability("Que marketplace genera mas incidencias", "Stats por marketplace", "/amazon-messages/stats/marketplaces"),
    capability("Que plantillas funcionan mejor", "Stats de plantillas", "/amazon-messages/stats/templates"),
  ];
}

function findOrder(email: ParsedAmazonEmail, orders: Order[]) {
  if (!email.amazonOrderId) return undefined;
  return orders.find((order) => {
    const values = [
      order.externalRef,
      order.id,
      order.odooRef,
      order.sendcloud?.reference,
    ]
      .filter(Boolean)
      .join(" ");
    return values.includes(email.amazonOrderId ?? "");
  });
}

function buildMessage(
  email: ParsedAmazonEmail,
  conversationId: string,
): AmazonSupportMessage {
  return {
    id: `msg-${email.uid}`,
    conversationId,
    direction: "inbound",
    source: "amazon_email_relay",
    externalMessageId: email.messageId,
    subject: email.subject,
    bodyText: email.cleanBody,
    fromLabel: email.from,
    toLabel: email.to,
    receivedAt: email.receivedAt,
    attachmentNames: email.attachmentNames,
    attachments: email.attachments.map((attachment) => ({
      ...attachment,
      conversationId,
    })),
  };
}

function template(
  id: string,
  name: string,
  category: AmazonMessageCategory,
  marketplace: string,
  language: string,
  variables: string[],
): AmazonTemplate {
  return {
    id,
    name,
    category,
    marketplace,
    language,
    status: id === "tpl-refund" ? "inactive" : "active",
    body: `Hola {cliente}, revisamos el pedido {amazon_order_id}. Usaremos los datos disponibles de {marketplace} antes de responder definitivamente.`,
    variables,
    usageCount: id === "tpl-tracking" ? 14 : id === "tpl-invoice" ? 9 : 3,
    acceptanceRate: id === "tpl-az" ? 0.64 : 0.82,
    createdBy: "Soporte",
    updatedAt: new Date("2026-06-20T12:00:00+02:00").toISOString(),
  };
}

function capability(
  question: string,
  dataSource: string,
  endpoint: string,
): AmazonSupportBotCapability {
  return {
    question,
    dataSource,
    endpoint,
    ready: true,
  };
}

function countRows(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, value]) => ({
      label,
      value,
      critical: /urgent|critical|a_to_z|A-to-Z/i.test(label),
    }))
    .sort((left, right) => right.value - left.value);
}

function suggestedTemplateId(category: AmazonMessageCategory) {
  const mapping: Partial<Record<AmazonMessageCategory, string>> = {
    tracking: "tpl-tracking",
    logistics_incident: "tpl-not-received",
    not_received: "tpl-not-received",
    delay: "tpl-delay",
    return: "tpl-return",
    defect: "tpl-defect",
    wrong_product: "tpl-wrong-product",
    warranty: "tpl-warranty",
    invoice: "tpl-invoice",
    cancellation: "tpl-cancel",
    technical: "tpl-technical",
    a_to_z: "tpl-az",
    refund: "tpl-refund",
  };
  return mapping[category];
}

function suggestedTemplateName(category: AmazonMessageCategory) {
  const mapping: Partial<Record<AmazonMessageCategory, string>> = {
    tracking: "Donde esta mi pedido",
    logistics_incident: "Pedido no recibido",
    not_received: "Pedido no recibido",
    delay: "Entrega retrasada",
    return: "Devolucion",
    defect: "Producto defectuoso",
    wrong_product: "Producto incorrecto",
    warranty: "Garantia",
    invoice: "Factura",
    cancellation: "Cancelacion",
    technical: "Consulta tecnica",
    a_to_z: "A-to-Z",
    refund: "Reembolso",
  };
  return mapping[category];
}

function knowledgeTags(category: AmazonMessageCategory) {
  const common = ["aprobada", "sanitizada"];
  if (category === "a_to_z") return [...common, "odr", "critica"];
  if (category === "return") return [...common, "devolucion"];
  if (category === "invoice") return [...common, "factura"];
  if (category === "technical") return [...common, "tecnica"];
  return [...common, "operativa"];
}

function finalApprovedResponse(conversation: AmazonConversation) {
  if (conversation.category === "cancellation") {
    return `Respuesta interna aprobada: comprobar envio del pedido ${conversation.amazonOrderId ?? ""} antes de aceptar o rechazar la cancelacion.`;
  }
  if (conversation.category === "a_to_z") {
    return `Caso critico validado por supervisor: revisar pruebas, causa raiz y posible apelacion del pedido ${conversation.amazonOrderId ?? ""}.`;
  }
  return conversation.draft?.body.replace("vamos a", "hemos empezado a") ?? "";
}

function buildContext(
  order: Order | undefined,
  category: AmazonMessageCategory,
): AmazonConversationContext {
  if (!order) return {};
  return {
    order,
    tracking: {
      carrier: order.sendcloud?.trackingNumber ? "Sendcloud" : "Pendiente",
      status: order.sendcloud?.status ?? order.deliveryStatus,
      trackingNumber: order.sendcloud?.trackingNumber,
      trackingUrl: order.sendcloud?.trackingUrl,
      lastEvent:
        order.sendcloud?.rawStatus ??
        (category === "tracking" ? "Pendiente de evento detallado" : "Sin incidencia"),
      updatedAt: new Date("2026-06-19T12:00:00+02:00").toISOString(),
    },
    invoice: {
      ref: order.invoiceStatus === "Facturado" ? `INV/${order.odooRef}` : "Pendiente",
      status: order.invoiceStatus,
      pdfAvailable: order.invoiceStatus === "Facturado",
    },
  };
}

function buildAudit(
  conversationId: string,
  email: ParsedAmazonEmail,
  category: AmazonMessageCategory,
  linked: boolean,
): AmazonAuditEvent[] {
  const importedAt = email.receivedAt;
  const classifiedAt = new Date(
    new Date(email.receivedAt).getTime() + 3 * 60 * 1000,
  ).toISOString();
  const draftAt = new Date(
    new Date(email.receivedAt).getTime() + 7 * 60 * 1000,
  ).toISOString();

  return [
    {
      id: `${conversationId}-audit-imported`,
      conversationId,
      eventType: "imported",
      label: "Email relay importado en modo demo",
      actor: "Sistema",
      createdAt: importedAt,
    },
    {
      id: `${conversationId}-audit-classified`,
      conversationId,
      eventType: "classified",
      label: `Clasificado como ${category}`,
      actor: "IA demo",
      createdAt: classifiedAt,
    },
    ...(linked
      ? [
          {
            id: `${conversationId}-audit-linked`,
            conversationId,
            eventType: "linked" as const,
            label: "Pedido Odoo vinculado por Amazon Order ID",
            actor: "Sistema",
            createdAt: classifiedAt,
          },
        ]
      : []),
    {
      id: `${conversationId}-audit-draft`,
      conversationId,
      eventType: "draft_generated",
      label: "Borrador demo generado sin capacidad de envio",
      actor: "IA demo",
      createdAt: draftAt,
    },
    ...email.attachments.map((attachment, index) => ({
      id: `${conversationId}-audit-attachment-${index + 1}`,
      conversationId,
      eventType: "attachment_received" as const,
      label: `Adjunto recibido: ${attachment.sanitizedName}`,
      actor: "Sistema",
      createdAt: importedAt,
    })),
  ];
}

function classifyEmail(email: ParsedAmazonEmail): AmazonMessageCategory {
  if (email.notificationType === "BRC_SELLER_NOTIFICATION") return "cancellation";
  if (email.notificationType === "RETURN_REQUEST") return "return";
  if (email.notificationType === "A_Z_CLAIM_RESPONDENT_CLOSE") return "a_to_z";
  if (email.operationalQueue === "logistics") return "logistics_incident";
  if (email.operationalQueue === "invoices") return "invoice";
  const value = `${email.subject} ${email.cleanBody}`.toLowerCase();
  if (containsAny(value, ["factura", "invoice"])) return "invoice";
  if (containsAny(value, ["defect", "defectuoso", "defectueux", "roto"])) {
    return "defect";
  }
  if (containsAny(value, ["devolucion", "return"])) return "return";
  if (containsAny(value, ["cancelacion", "cancel"])) return "cancellation";
  if (containsAny(value, ["retraso", "delay", "tarde"])) return "delay";
  if (containsAny(value, ["donde esta", "tracking", "seguimiento", "enviado"])) {
    return "tracking";
  }
  if (containsAny(value, ["garantia", "warranty"])) return "warranty";
  if (containsAny(value, ["compatible", "instalacion", "technical", "tecnica"])) {
    return "technical";
  }
  return "other";
}

function prioritize(
  parsedPriority: AmazonConversationPriority,
  category: AmazonMessageCategory,
  context: AmazonConversationContext,
): AmazonConversationPriority {
  if (parsedPriority === "urgent" || parsedPriority === "high") return parsedPriority;
  if (category === "a_to_z") return "urgent";
  if (category === "defect" || category === "return") return "high";
  if (category === "tracking" && !context.tracking?.trackingNumber) return "urgent";
  if (category === "invoice" && !context.invoice?.pdfAvailable) return "high";
  if (category === "technical") return "normal";
  return "normal";
}

function statusForCategory(
  category: AmazonMessageCategory,
): AmazonConversationStatus {
  if (category === "a_to_z") return "pending_internal";
  if (category === "cancellation" || category === "return") return "pending_internal";
  return category === "technical" ? "open" : "new";
}

function draftReply(
  email: ParsedAmazonEmail,
  category: AmazonMessageCategory,
  context: AmazonConversationContext,
) {
  const orderRef = email.amazonOrderId ?? "tu pedido";
  if (category === "tracking") {
    if (context.tracking?.trackingNumber) {
      return `Hola, gracias por escribirnos. Hemos revisado el pedido ${orderRef}. El envio figura con seguimiento ${context.tracking.trackingNumber} y estado "${context.tracking.status}". Puedes consultarlo aqui: ${context.tracking.trackingUrl ?? "en el enlace de seguimiento del pedido"}. Un saludo.`;
    }
    return `Hola, gracias por escribirnos. Estamos revisando el estado del pedido ${orderRef}. Ahora mismo no tenemos un tracking seguro para confirmar, asi que vamos a comprobarlo antes de darte una respuesta definitiva. Un saludo.`;
  }
  if (category === "logistics_incident") {
    return `Hola, gracias por escribirnos. Vamos a revisar el transporte del pedido ${orderRef}, comprobar el seguimiento y confirmar la mejor solucion antes de responderte. Un saludo.`;
  }
  if (category === "invoice") {
    if (context.invoice?.pdfAvailable) {
      return `Hola, gracias por contactar. Tenemos localizada la factura del pedido ${orderRef}. La dejamos preparada para adjuntar tras validacion del operador. Un saludo.`;
    }
    return `Hola, gracias por contactar. Vamos a revisar la factura del pedido ${orderRef} y te la enviaremos en cuanto este disponible. Un saludo.`;
  }
  if (category === "defect") {
    return `Hola, sentimos la incidencia con el pedido ${orderRef}. Para revisarlo correctamente, vamos a comprobar la compra y las fotos adjuntas antes de indicarte los siguientes pasos. Un saludo.`;
  }
  if (category === "cancellation") {
    return `Nota interna: comprobar si el pedido ${orderRef} ya esta enviado. Si no esta enviado, cancelar con motivo comprador. Si ya esta enviado, responder indicando rechazo de entrega o devolucion.`;
  }
  if (category === "return") {
    return `Nota interna: revisar devolucion del pedido ${orderRef}, motivo, SKU, cantidad y estado en Amazon/Odoo antes de cerrar la solicitud.`;
  }
  if (category === "a_to_z") {
    return email.isInternationalReturnAddressRisk
      ? `Nota critica: revisar A-to-Z del pedido ${orderRef}. Amazon indica riesgo por direccion de devolucion internacional/local return address. Preparar apelacion si procede y corregir la causa raiz.`
      : `Nota critica: revisar A-to-Z del pedido ${orderRef}, documentar causa raiz y preparar apelacion si procede.`;
  }
  if (category === "technical") {
    return "Hola, gracias por tu consulta. Vamos a revisar la compatibilidad tecnica antes de confirmarte la respuesta para evitar indicarte algo incorrecto. Un saludo.";
  }
  return "Hola, gracias por escribirnos. Revisamos tu consulta y te responderemos con la informacion correcta lo antes posible. Un saludo.";
}

function containsAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function hashAlias(alias: string) {
  let hash = 0;
  for (let index = 0; index < alias.length; index += 1) {
    hash = Math.imul(31, hash) + alias.charCodeAt(index);
  }
  return `buyer-${(hash >>> 0).toString(16)}`;
}
