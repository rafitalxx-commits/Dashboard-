import type { createAmazonMessagesRepository } from "./repository.ts";
import type { AmazonMessagesActor } from "./schema.ts";

type Repository = ReturnType<typeof createAmazonMessagesRepository>;

export type AmazonAgentDraftWorkerOptions = {
  enabled?: boolean;
  intervalMs?: number;
  runImmediately?: boolean;
};

export type AmazonAgentDraftWorkerResult =
  | { processed: false; status: "IDLE" }
  | {
      processed: true;
      status: "COMPLETED" | "FAILED";
      requestId: string;
      conversationId: string;
      draftId?: string;
      errorMessage?: string;
    };

export async function processNextAmazonAgentDraft(
  repository: Repository,
  actor: AmazonMessagesActor,
): Promise<AmazonAgentDraftWorkerResult> {
  const request = repository.claimNextHermesDraftRequest(actor);
  if (!request) return { processed: false, status: "IDLE" };

  try {
    const generated = await repository.generateSmartDraft(
      actor,
      request.conversationId,
      { externalSend: false },
    );
    const completed = repository.completeHermesDraftRequest(
      actor,
      request.requestId,
      {
        draftBody: generated.draftBody,
        operatorSummary:
          "Juanito analizo el mensaje y preparo un borrador para revision humana.",
        customerLanguage: generated.detectedLanguage,
        confidence: generated.confidence,
        warnings: generated.warnings,
        externalSend: false,
      },
    );
    return {
      processed: true,
      status: "COMPLETED",
      requestId: request.requestId,
      conversationId: request.conversationId,
      draftId: completed.draft.draftId,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Juanito no pudo generar el borrador";
    repository.failHermesDraftRequest(actor, request.requestId, {
      errorMessage,
      externalSend: false,
    });
    return {
      processed: true,
      status: "FAILED",
      requestId: request.requestId,
      conversationId: request.conversationId,
      errorMessage,
    };
  }
}

export function startAmazonAgentDraftWorker(
  repository: Repository,
  actor: AmazonMessagesActor,
  options: AmazonAgentDraftWorkerOptions = {},
) {
  const enabled = options.enabled ?? false;
  if (!enabled) {
    return { enabled: false, stop() {} };
  }

  const intervalMs = Math.max(1_000, options.intervalMs ?? 15_000);
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await processNextAmazonAgentDraft(repository, actor);
      if (result.processed) {
        console.info("[amazon-messages:agent-draft-worker] request processed", {
          requestId: result.requestId,
          conversationId: result.conversationId,
          status: result.status,
        });
      }
    } catch (error) {
      console.error(
        "[amazon-messages:agent-draft-worker] cycle failed without stopping dashboard",
        error,
      );
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => void tick(), intervalMs);
  interval.unref();
  if (options.runImmediately ?? true) void tick();

  return {
    enabled: true,
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}

const AGENT_DRAFT_WORKER_KEY = "__amazonMessagesAgentDraftWorker";

type AgentDraftWorkerGlobal = typeof globalThis & {
  [AGENT_DRAFT_WORKER_KEY]?: ReturnType<typeof startAmazonAgentDraftWorker>;
};

export function ensureAmazonMessagesAgentDraftWorker(
  repository: Repository,
  actor: AmazonMessagesActor,
  options: AmazonAgentDraftWorkerOptions = {},
) {
  const globalState = globalThis as AgentDraftWorkerGlobal;
  globalState[AGENT_DRAFT_WORKER_KEY]?.stop();
  const worker = startAmazonAgentDraftWorker(repository, actor, options);
  globalState[AGENT_DRAFT_WORKER_KEY] = worker;
  return worker;
}
