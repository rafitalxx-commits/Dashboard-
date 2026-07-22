import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type {
  AmazonShipmentConfirmationDraft,
  AmazonShipmentRecord,
  AmazonShipmentStatus,
  AmazonShipmentStore,
} from "./schema.ts";

type RepositoryOptions = {
  dataDir?: string;
  storePath?: string;
};

export function createAmazonShipmentRepository(options: RepositoryOptions = {}) {
  const storePath =
    options.storePath ??
    join(
      options.dataDir ?? process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data",
      "amazon-sp-api-shipments.json",
    );

  function ensureStore() {
    if (existsSync(storePath)) return;
    mkdirSync(dirname(storePath), { recursive: true });
    writeStore({ shipments: [] });
  }

  function readStore(): AmazonShipmentStore {
    ensureStore();
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Partial<AmazonShipmentStore>;
    return { shipments: Array.isArray(parsed.shipments) ? parsed.shipments : [] };
  }

  function writeStore(store: AmazonShipmentStore) {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  }

  function list() {
    return readStore().shipments;
  }

  function get(id: string) {
    return readStore().shipments.find((shipment) => shipment.id === id);
  }

  function upsertDraft(draft: AmazonShipmentConfirmationDraft, input: { dryRun: boolean; request?: unknown }) {
    const store = readStore();
    const existingIndex = store.shipments.findIndex((shipment) =>
      shipment.amazonOrderId === draft.amazonOrderId &&
      shipment.pickingId === draft.pickingId &&
      shipment.tracking === draft.tracking,
    );
    const now = new Date().toISOString();
    const previous = existingIndex >= 0 ? store.shipments[existingIndex] : null;
    const record: AmazonShipmentRecord = {
      ...draft,
      id: previous?.id ?? createRecordId(draft),
      status: previous?.status === "sent" ? "sent" : "pending",
      amazonResponse: previous?.amazonResponse,
      lastRequest: input.request ?? previous?.lastRequest,
      retries: previous?.retries ?? 0,
      dryRun: input.dryRun,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      sentAt: previous?.sentAt,
    };
    if (existingIndex >= 0) store.shipments[existingIndex] = record;
    else store.shipments.unshift(record);
    writeStore(store);
    return record;
  }

  function updateResult(
    id: string,
    patch: {
      status: AmazonShipmentStatus;
      amazonResponse?: unknown;
      lastRequest?: unknown;
      lastError?: string;
      dryRun?: boolean;
      incrementRetries?: boolean;
    },
  ) {
    const store = readStore();
    const index = store.shipments.findIndex((shipment) => shipment.id === id);
    if (index < 0) throw new Error("Expedicion Amazon no encontrada");
    const previous = store.shipments[index];
    const next: AmazonShipmentRecord = {
      ...previous,
      status: patch.status,
      amazonResponse: patch.amazonResponse ?? previous.amazonResponse,
      lastRequest: patch.lastRequest ?? previous.lastRequest,
      lastError: patch.lastError,
      retries: previous.retries + (patch.incrementRetries ? 1 : 0),
      dryRun: patch.dryRun ?? previous.dryRun,
      updatedAt: new Date().toISOString(),
      sentAt: patch.status === "sent" ? new Date().toISOString() : previous.sentAt,
    };
    store.shipments[index] = next;
    writeStore(store);
    return next;
  }

  return { get, list, updateResult, upsertDraft };
}

function createRecordId(draft: AmazonShipmentConfirmationDraft) {
  return createHash("sha256")
    .update([draft.amazonOrderId, draft.pickingId, draft.tracking].join("|"))
    .digest("hex")
    .slice(0, 16);
}
