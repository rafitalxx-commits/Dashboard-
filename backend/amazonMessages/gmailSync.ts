import type { createAmazonMessagesRepository } from "./repository.ts";
import type { AmazonMessagesActor } from "./schema.ts";
import {
  createGmailReadonlySourceWithGogFallback,
  explainMissingGmailSetup,
  gmailReadonlyConfigFromEnv,
  type GmailReadonlyConfig,
  type GmailReadonlySource,
} from "./gmailClient.ts";

type Repository = ReturnType<typeof createAmazonMessagesRepository>;

export type GmailSyncOptions = {
  config?: GmailReadonlyConfig;
  source?: GmailReadonlySource;
  trigger?: "manual" | "auto";
  labelName?: string;
  maxMessages?: number;
};

type GmailAutoSyncOptions = {
  intervalMinutes?: number;
};

export async function syncAmazonMessagesFromGmail(
  repository: Repository,
  actor: AmazonMessagesActor,
  options: GmailSyncOptions = {},
) {
  const startedAt = Date.now();
  const trigger = options.trigger ?? "manual";
  let runId: string;

  try {
    runId = repository.startGmailSyncRun(actor, { trigger }).runId;
  } catch (error) {
    return {
      ok: false as const,
      mode: "locked" as const,
      status: "EN_CURSO" as const,
      message:
        error instanceof Error
          ? error.message
          : "Sincronizacion Gmail ya en curso",
      scanned: 0,
      imported: 0,
      updated: 0,
      duplicates: 0,
      errors: 1,
      processMs: Date.now() - startedAt,
    };
  }

  const baseConfig =
    options.config ?? gmailReadonlyConfigFromEnv(process.env as Record<string, string>);
  const config = {
    ...baseConfig,
    labelName: options.labelName ?? baseConfig.labelName,
    maxMessages: options.maxMessages ?? baseConfig.maxMessages,
  };
  const missing = explainMissingGmailSetup(config);
  if (missing && options.config && !options.source) {
    repository.finishGmailSyncRun(actor, {
      runId,
      trigger,
      status: "ERROR",
      scanned: 0,
      imported: 0,
      updated: 0,
      duplicates: 0,
      errors: 1,
      message: missing,
      processMs: Date.now() - startedAt,
    });
    return {
      ok: false as const,
      mode: "not_configured" as const,
      message: missing,
      scanned: 0,
      imported: 0,
      updated: 0,
      duplicates: 0,
      errors: 1,
      processMs: Date.now() - startedAt,
    };
  }
  const source = options.source ?? createGmailReadonlySourceWithGogFallback(config);
  const syncState = repository.getGmailSync(actor);

  try {
    const listed = await source.listLabelMessages({
      labelName: config.labelName,
      maxMessages: config.maxMessages,
      after: trigger === "auto" ? syncState?.lastSyncedAt : undefined,
    });
    const results = [];
    for (const message of listed.messages) {
      results.push(
        await repository.importGmailMessage(actor, {
          gmailMessageId: message.id,
          gmailThreadId: message.threadId,
          rawEmail: message.rawEmail,
          historyId: message.historyId,
        }),
      );
    }

    const summary = {
      ok: true as const,
      mode: "gmail_readonly" as const,
      account: config.account,
      labelName: config.labelName,
      labelId: listed.labelId,
      scanned: listed.messages.length,
      imported: results.filter((item) => item.status === "imported").length,
      updated: results.filter((item) => item.status === "updated").length,
      duplicates: results.filter((item) => item.status === "duplicate").length,
      errors: 0,
      processMs: Date.now() - startedAt,
      results,
    };
    repository.finishGmailSyncRun(actor, {
      runId,
      trigger,
      status: "OK",
      scanned: summary.scanned,
      imported: summary.imported,
      updated: summary.updated,
      duplicates: summary.duplicates,
      errors: 0,
      processMs: summary.processMs,
      labelId: listed.labelId,
    });
    return summary;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido leyendo Gmail";
    repository.finishGmailSyncRun(actor, {
      runId,
      trigger,
      status: "ERROR",
      scanned: 0,
      imported: 0,
      updated: 0,
      duplicates: 0,
      errors: 1,
      message,
      processMs: Date.now() - startedAt,
    });
    return {
      ok: false as const,
      mode: "gmail_readonly" as const,
      message,
      scanned: 0,
      imported: 0,
      updated: 0,
      duplicates: 0,
      errors: 1,
      processMs: Date.now() - startedAt,
    };
  }
}

const AUTO_SYNC_KEY = "__amazonMessagesGmailAutoSync";

type AutoSyncGlobal = typeof globalThis & {
  [AUTO_SYNC_KEY]?: {
    repository: Repository;
    interval?: ReturnType<typeof setInterval>;
  };
};

export function ensureAmazonMessagesGmailAutoSync(
  repository: Repository,
  actor: AmazonMessagesActor,
  options: GmailAutoSyncOptions = {},
) {
  const intervalMinutes = options.intervalMinutes ?? 30;
  repository.configureGmailSyncJob(actor, {
    enabled: true,
    intervalMinutes,
  });

  const globalState = globalThis as AutoSyncGlobal;
  if (globalState[AUTO_SYNC_KEY]?.interval) {
    globalState[AUTO_SYNC_KEY]!.repository = repository;
    return;
  }

  const interval = setInterval(() => {
    void runDueAmazonMessagesGmailSync(repository, actor).catch((error) => {
      console.error(
        "[amazon-messages:gmail-sync] Auto sync failed without stopping dashboard",
        error,
      );
    });
  }, Math.min(60_000, intervalMinutes * 60_000));
  globalState[AUTO_SYNC_KEY] = { repository, interval };
}

async function runDueAmazonMessagesGmailSync(
  repository: Repository,
  actor: AmazonMessagesActor,
) {
  let state: ReturnType<Repository["getGmailSync"]>;
  try {
    state = repository.getGmailSync(actor);
  } catch (error) {
    console.error(
      "[amazon-messages:gmail-sync] Could not read sync state; skipping auto sync",
      error,
    );
    return;
  }
  if (!state?.jobEnabled || state.status === "EN_CURSO") return;
  if (state.nextSyncAt && new Date(state.nextSyncAt).getTime() > Date.now()) return;
  await syncAmazonMessagesFromGmail(repository, actor, {
    trigger: "auto",
    maxMessages: 20,
  });
}
