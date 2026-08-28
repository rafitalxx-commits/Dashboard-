import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createPrestashopClient } from "./client.ts";

export type PrestashopTrackingStatus = "PENDING" | "SYNCED" | "ERROR";

export type PrestashopTrackingRecord = {
  id: string;
  odooOrderId: string;
  prestashopOrderId: string;
  prestashopReference?: string;
  trackingNumber: string;
  provider: string;
  serviceCode?: string;
  status: PrestashopTrackingStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  syncedAt?: string;
  lastError?: string;
  orderCarrierId?: string;
  idCarrier?: string;
  shippedStateApplied?: boolean;
};

type Store = { records: PrestashopTrackingRecord[] };

export type PublishPrestashopTrackingInput = {
  odooOrderId: string;
  prestashopOrderId?: string;
  prestashopReference?: string;
  trackingNumber: string;
  provider: string;
  serviceCode?: string;
};

export function createPrestashopTrackingPublisher(env: Record<string, string>) {
  const client = createPrestashopClient(env);
  const store = createPrestashopTrackingStore(env);

  async function publishPrestashopTracking(input: PublishPrestashopTrackingInput) {
    const normalized = normalizeInput(input);
    const pending = store.upsertPending(normalized);
    if (pending.status === "SYNCED") return pending;

    try {
      const prestashopOrderId = normalized.prestashopOrderId ||
        (normalized.prestashopReference ? await client.findOrderIdByReference(normalized.prestashopReference) : "");
      if (!prestashopOrderId) throw new Error("No se ha localizado id_order de PrestaShop");

      const orderCarrier = await waitForOrderCarrier(prestashopOrderId);
      if (!orderCarrier) throw new Error("PrestaShop no ha devuelto order_carrier para el pedido");

      const order = await client.getOrder(prestashopOrderId);
      const alreadyTracking = normalize(orderCarrier.tracking_number) === normalize(normalized.trackingNumber);
      if (!alreadyTracking) {
        await client.updateOrderCarrierTracking(orderCarrier, normalized.trackingNumber);
      }

      const shippedStateId = env.PRESTASHOP_SHIPPED_STATE_ID || "4";
      const alreadyShipped = normalize(order.currentState) === normalize(shippedStateId);
      if (!alreadyShipped) {
        await client.createOrderHistory(prestashopOrderId);
      }

      return store.markSynced(pending.id, {
        prestashopOrderId,
        orderCarrierId: orderCarrier.id,
        idCarrier: orderCarrier.id_carrier,
        shippedStateApplied: !alreadyShipped,
      });
    } catch (error) {
      return store.markError(pending.id, error instanceof Error ? error.message : "No se pudo sincronizar PrestaShop");
    }
  }

  return {
    status: client.status,
    list: store.list,
    findByOdooOrderId: store.findByOdooOrderId,
    prepare(input: PublishPrestashopTrackingInput) {
      return store.upsertPending(normalizeInput(input));
    },
    publishPrestashopTracking,
  };

  async function waitForOrderCarrier(prestashopOrderId: string) {
    const attempts = Math.max(1, Number(env.PRESTASHOP_ORDER_CARRIER_RETRY_ATTEMPTS || 4));
    const delayMs = Math.max(0, Number(env.PRESTASHOP_ORDER_CARRIER_RETRY_DELAY_MS || 750));
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const orderCarrier = await client.getOrderCarrier(prestashopOrderId);
      if (orderCarrier) return orderCarrier;
      if (attempt < attempts && delayMs > 0) await delay(delayMs);
    }
    return null;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPrestashopTrackingStore(env: Record<string, string>) {
  const storePath = join(env.DASHBOARD_DATA_DIR || ".dashboard-data", "prestashop-tracking-sync.json");

  function ensureStore() {
    if (existsSync(storePath)) return;
    mkdirSync(dirname(storePath), { recursive: true });
    writeStore({ records: [] });
  }

  function readStore(): Store {
    ensureStore();
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Partial<Store>;
    return { records: Array.isArray(parsed.records) ? parsed.records : [] };
  }

  function writeStore(store: Store) {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  }

  function list() {
    return readStore().records;
  }

  function findByOdooOrderId(odooOrderId: string) {
    const normalized = normalizeOdooOrderId(odooOrderId);
    return readStore().records.find((record) => normalizeOdooOrderId(record.odooOrderId) === normalized) ?? null;
  }

  function upsertPending(input: Required<Pick<PublishPrestashopTrackingInput, "odooOrderId" | "trackingNumber" | "provider">> & PublishPrestashopTrackingInput) {
    const store = readStore();
    const now = new Date().toISOString();
    const id = buildRecordId(input.odooOrderId, input.trackingNumber);
    const existingIndex = store.records.findIndex((record) => record.id === id);
    const existing = existingIndex >= 0 ? store.records[existingIndex] : null;
    const next: PrestashopTrackingRecord = {
      id,
      odooOrderId: normalizeOdooOrderId(input.odooOrderId),
      prestashopOrderId: normalize(input.prestashopOrderId),
      prestashopReference: normalize(input.prestashopReference),
      trackingNumber: normalize(input.trackingNumber),
      provider: normalize(input.provider),
      serviceCode: normalize(input.serviceCode),
      status: existing?.status === "SYNCED" ? "SYNCED" : "PENDING",
      attempts: existing?.attempts ?? 0,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastRunAt: existing?.lastRunAt,
      syncedAt: existing?.syncedAt,
      lastError: existing?.status === "SYNCED" ? existing.lastError : undefined,
      orderCarrierId: existing?.orderCarrierId,
      idCarrier: existing?.idCarrier,
      shippedStateApplied: existing?.shippedStateApplied,
    };
    if (existingIndex >= 0) store.records[existingIndex] = next;
    else store.records.unshift(next);
    writeStore(store);
    return next;
  }

  function markSynced(id: string, patch: Partial<PrestashopTrackingRecord>) {
    return update(id, {
      ...patch,
      status: "SYNCED",
      syncedAt: new Date().toISOString(),
      lastError: undefined,
    });
  }

  function markError(id: string, message: string) {
    return update(id, { status: "ERROR", lastError: message });
  }

  function update(id: string, patch: Partial<PrestashopTrackingRecord>) {
    const store = readStore();
    const index = store.records.findIndex((record) => record.id === id);
    if (index < 0) throw new Error("Sin registro PrestaShop pendiente");
    const now = new Date().toISOString();
    const next = {
      ...store.records[index],
      ...patch,
      attempts: (store.records[index].attempts || 0) + 1,
      lastRunAt: now,
      updatedAt: now,
    };
    store.records[index] = next;
    writeStore(store);
    return next;
  }

  return { findByOdooOrderId, list, markError, markSynced, upsertPending };
}

function normalizeInput(input: PublishPrestashopTrackingInput) {
  const normalized = {
    ...input,
    odooOrderId: normalizeOdooOrderId(input.odooOrderId),
    prestashopOrderId: normalize(input.prestashopOrderId),
    prestashopReference: normalize(input.prestashopReference),
    trackingNumber: normalize(input.trackingNumber),
    provider: normalize(input.provider),
    serviceCode: normalize(input.serviceCode),
  };
  if (!normalized.odooOrderId) throw new Error("Falta odooOrderId");
  if (!normalized.trackingNumber) throw new Error("Falta trackingNumber");
  if (!normalized.provider) throw new Error("Falta provider");
  if (!normalized.prestashopOrderId && !normalized.prestashopReference) {
    throw new Error("Falta prestashopOrderId o referencia PrestaShop");
  }
  return normalized as Required<Pick<PublishPrestashopTrackingInput, "odooOrderId" | "trackingNumber" | "provider">> & PublishPrestashopTrackingInput;
}

function buildRecordId(odooOrderId: string, trackingNumber: string) {
  return `${normalizeOdooOrderId(odooOrderId)}:${normalize(trackingNumber).toUpperCase()}`;
}

function normalizeOdooOrderId(value?: string) {
  return normalize(value).replace(/^#/, "");
}

function normalize(value?: string | number) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
