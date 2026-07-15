import {
  actorFromDashboardUser,
  createAmazonMessagesRepository,
} from "./repository.ts";
import type { AmazonMessagesActor } from "./schema.ts";
import {
  ensureAmazonMessagesGmailAutoSync,
  syncAmazonMessagesFromGmail,
} from "./gmailSync.ts";
import {
  createGmailApiFinalDraftSendSource,
  createGmailApiDraftSource,
  gmailDraftConfigFromEnv,
} from "./gmailClient.ts";
import type { GmailFinalDraftSendSource } from "./gmailClient.ts";
import type { AmazonOutboundMode } from "./schema.ts";

type MiddlewareServer = {
  middlewares: {
    use: (path: string, handler: (request: any, response: any) => void) => void;
  };
};

type AuthReader = {
  getSessionUser: (cookie?: string) =>
    | {
        id: string;
        name: string;
        role: string;
        permissions: string[];
      }
    | undefined;
};

type RouteOptions = {
  dataDir?: string;
  finalDraftSendSource?: GmailFinalDraftSendSource;
};

export function registerAmazonMessagesRoutes(
  server: MiddlewareServer,
  auth: AuthReader,
  options: RouteOptions = {},
) {
  const repository = createAmazonMessagesRepository({ dataDir: options.dataDir });
  const gmailDraftSource = createGmailApiDraftSource(
    gmailDraftConfigFromEnv(process.env),
  );
  const finalDraftSendSource =
    options.finalDraftSendSource ??
    createGmailApiFinalDraftSendSource(gmailDraftConfigFromEnv(process.env));
  ensureAmazonMessagesGmailAutoSync(repository, {
    id: "amazon-gmail-auto-sync",
    name: "Amazon Gmail Auto Sync",
    role: "ADMIN",
  });

  server.middlewares.use("/api/amazon-messages", async (request, response) => {
    const actor = actorFromDashboardUser(
      auth.getSessionUser(request.headers.cookie),
    );
    if (!actor) {
      sendJson(response, 401, { message: "Login requerido" });
      return;
    }

    try {
      const url = new URL(request.url ?? "/", "http://local");
      const parts = url.pathname.split("/").filter(Boolean);

      if (request.method === "GET" && parts[0] === "conversations" && parts[1] === "pending") {
        sendJson(
          response,
          200,
          repository.listConversations(actor).filter((item) => item.status !== "resolved"),
        );
        return;
      }

      if (request.method === "GET" && parts[0] === "conversations" && parts[1] === "critical") {
        sendJson(
          response,
          200,
          repository.listConversations(actor, { priority: "urgent" }),
        );
        return;
      }

      if (parts[0] === "conversations" && parts[1] && parts[2] === "draft") {
        if (request.method === "GET") {
          sendJson(response, 200, repository.getInternalDraft(actor, parts[1]));
          return;
        }
        if (request.method === "POST" && parts[3] === "from-template") {
          sendJson(
            response,
            200,
            await repository.applyTemplateToInternalDraft(
              actor,
              parts[1],
              await readJsonBody(request),
            ),
          );
          return;
        }
        if (request.method === "POST" && parts[3] === "review") {
          sendJson(
            response,
            200,
            repository.reviewInternalDraft(
              actor,
              parts[1],
              await readJsonBody(request),
            ),
          );
          return;
        }
        if (request.method === "POST" && parts[3] === "smart") {
          sendJson(
            response,
            201,
            await repository.generateSmartDraft(
              actor,
              parts[1],
              await readJsonBody(request),
            ),
          );
          return;
        }
        if (request.method === "POST" && parts[3] === "hermes-request") {
          sendJson(
            response,
            201,
            repository.createHermesDraftRequest(
              actor,
              parts[1],
              await readJsonBody(request),
            ),
          );
          return;
        }
        if (request.method === "POST") {
          sendJson(
            response,
            201,
            repository.createInternalDraft(
              actor,
              parts[1],
              await readJsonBody(request),
            ),
          );
          return;
        }
        if (request.method === "PUT") {
          sendJson(
            response,
            200,
            repository.updateInternalDraft(
              actor,
              parts[1],
              await readJsonBody(request),
            ),
          );
          return;
        }
      }

      if (parts[0] === "conversations" && parts[1] && parts[2] === "pending-reply") {
        if (request.method === "GET") {
          sendJson(response, 200, repository.getPendingReply(actor, parts[1]));
          return;
        }
        if (request.method === "POST" && parts[3] === "review") {
          sendJson(
            response,
            200,
            repository.reviewPendingReply(
              actor,
              parts[1],
              await readJsonBody(request),
            ),
          );
          return;
        }
        if (request.method === "POST") {
          const existingPendingReply = repository.getPendingReply(actor, parts[1]);
          sendJson(
            response,
            existingPendingReply.status === "SIN_RESPUESTA" ? 201 : 200,
            repository.preparePendingReply(
              actor,
              parts[1],
              await readJsonBody(request),
            ),
          );
          return;
        }
        if (request.method === "PUT") {
          sendJson(
            response,
            200,
            repository.updatePendingReply(
              actor,
              parts[1],
              await readJsonBody(request),
            ),
          );
          return;
        }
      }

      if (parts[0] === "conversations" && parts[1] && parts[2] === "gmail-draft") {
        if (request.method === "POST" || request.method === "PUT") {
          const body = await readJsonBody<{
            externalSend?: boolean;
            confirmDraftOnly?: boolean;
          }>(request);
          if (body.externalSend === true) {
            throw new Error("Gmail draft_only no permite envio externo");
          }
          if (body.confirmDraftOnly !== true) {
            throw new Error("Confirmacion draft_only requerida");
          }
          const outboundMode = amazonOutboundModeFromEnv(process.env);
          if (outboundMode === "disabled") {
            throw new Error(
              "AMAZON_MESSAGES_OUTBOUND_MODE=disabled: creacion de borrador Gmail bloqueada",
            );
          }
          if (outboundMode !== "draft_only" && outboundMode !== "manual_send") {
            throw new Error(
              `AMAZON_MESSAGES_OUTBOUND_MODE=${outboundMode}: modo no permitido para borrador Gmail`,
            );
          }
          const payload = repository.buildGmailDraftPayload(actor, parts[1]);
          try {
            const gmailDraft = await gmailDraftSource.createOrUpdateDraft({
              gmailDraftId: payload.gmailDraftId,
              to: payload.recipient,
              subject: payload.subject,
              bodyText: payload.bodyText,
              threadId: payload.gmailThreadId,
            });
            const result = repository.recordGmailDraft(actor, parts[1], {
              pendingReplyId: payload.pendingReplyId,
              gmailDraftId: gmailDraft.id,
              gmailThreadId: gmailDraft.threadId ?? payload.gmailThreadId,
              recipient: payload.recipient,
              subject: payload.subject,
              bodyHash: payload.bodyHash,
              status: payload.gmailDraftId
                ? "BORRADOR_GMAIL_ACTUALIZADO"
                : "BORRADOR_GMAIL_CREADO",
            });
            sendJson(response, payload.gmailDraftId ? 200 : 201, result);
            return;
          } catch (error) {
            repository.recordGmailDraftFailure(actor, parts[1], {
              pendingReplyId: payload.pendingReplyId,
              recipient: payload.recipient,
              subject: payload.subject,
              bodyHash: payload.bodyHash,
              message:
                error instanceof Error
                  ? error.message
                  : "Error creando borrador Gmail",
            });
            throw error;
          }
        }
      }

      if (parts[0] === "conversations" && parts[1] && parts[2] === "finalize-mock") {
        if (request.method === "POST") {
          const body = await readJsonBody<{
            externalSend?: boolean;
            realDelivery?: boolean;
          }>(request);
          if (body.externalSend === true || body.realDelivery === true) {
            throw new Error("Envio real bloqueado en manual_send_mock");
          }
          const outboundMode = amazonOutboundModeFromEnv(process.env);
          if (outboundMode !== "manual_send") {
            throw new Error(
              `AMAZON_MESSAGES_OUTBOUND_MODE=${outboundMode}: manual_send_mock requiere manual_send`,
            );
          }
          sendJson(
            response,
            200,
            repository.finalizeManualSendMock(actor, parts[1], body),
          );
          return;
        }
      }

      if (parts[0] === "conversations" && parts[1] && parts[2] === "finalize") {
        if (request.method === "POST") {
          const body = await readJsonBody<{
            recipient?: string;
            externalSend?: boolean;
          }>(request);
          const outboundMode = amazonOutboundModeFromEnv(process.env);
          if (outboundMode !== "manual_send") {
            throw new Error(
              `AMAZON_MESSAGES_OUTBOUND_MODE=${outboundMode}: envio final requiere manual_send`,
            );
          }
          if (process.env.RUN_REAL_GMAIL_SEND_VALIDATION === "true") {
            assertAllowedValidationRecipient(body.recipient, process.env);
          }
          const finalization = repository.beginFinalGmailDraftSend(
            actor,
            parts[1],
            body,
          );
          if (finalization.status === "SENT") {
            sendJson(response, 200, finalization);
            return;
          }
          try {
            const sent = await finalDraftSendSource.sendExistingDraft({
              gmailDraftId: finalization.gmailDraftId,
            });
            sendJson(
              response,
              200,
              repository.recordFinalGmailDraftSent(actor, parts[1], {
                finalizationId: finalization.finalizationId,
                sentMessageId: sent.sentMessageId,
              }),
            );
            return;
          } catch (error) {
            repository.recordFinalGmailDraftFailed(actor, parts[1], {
              finalizationId: finalization.finalizationId,
              message:
                error instanceof Error
                  ? error.message
                  : "Error en envio final Gmail",
            });
            throw error;
          }
        }
      }

      if (parts[0] === "conversations" && parts[1] && parts[2] === "workflow") {
        if (request.method === "POST") {
          sendJson(
            response,
            200,
            repository.updateConversationWorkflow(
              actor,
              parts[1],
              await readJsonBody(request),
            ),
          );
          return;
        }
      }

      if (parts[0] === "conversations" && parts[1] && parts[2] === "assign") {
        if (request.method === "PUT") {
          sendJson(
            response,
            200,
            repository.assignConversationWorkflow(
              actor,
              parts[1],
              await readJsonBody(request),
            ),
          );
          return;
        }
      }

      if (request.method === "GET" && parts[0] === "conversations" && parts[1]) {
        sendJson(response, 200, await repository.getConversation(actor, parts[1]));
        return;
      }

      if (request.method === "GET" && parts[0] === "conversations") {
        sendJson(response, 200, repository.listConversations(actor, {
          status: url.searchParams.get("status") ?? undefined,
          workflowStatus: normalizeWorkflowStatusParam(
            url.searchParams.get("workflowStatus"),
          ),
          priority: url.searchParams.get("priority") ?? undefined,
          category: url.searchParams.get("category") ?? undefined,
          marketplace: url.searchParams.get("marketplace") ?? undefined,
        }));
        return;
      }

      if (request.method === "GET" && parts[0] === "conversation" && parts[1]) {
        sendJson(response, 200, await repository.getConversation(actor, parts[1]));
        return;
      }

      if (request.method === "GET" && parts[0] === "stats") {
        sendJson(response, 200, repository.getStats(actor));
        return;
      }

      if (request.method === "GET" && parts[0] === "templates") {
        sendJson(response, 200, repository.listTemplates(actor));
        return;
      }

      if (request.method === "GET" && parts[0] === "knowledge") {
        sendJson(response, 200, repository.listKnowledge(actor, {
          query: url.searchParams.get("q") ?? undefined,
          order: url.searchParams.get("order") ?? undefined,
          category: url.searchParams.get("category") ?? undefined,
          language: url.searchParams.get("language") ?? undefined,
          templateId: url.searchParams.get("templateId") ?? undefined,
          approver: url.searchParams.get("approver") ?? undefined,
        }));
        return;
      }

      if (request.method === "POST" && parts[0] === "knowledge" && parts[1] === "examples") {
        sendJson(
          response,
          201,
          repository.saveApprovedKnowledgeExample(
            actor,
            await readJsonBody(request),
          ),
        );
        return;
      }

      if (parts[0] === "knowledge" && parts[1] === "examples" && parts[2]) {
        if (request.method === "PUT" && parts[3] === "tags") {
          sendJson(
            response,
            200,
            repository.updateKnowledgeTags(
              actor,
              parts[2],
              await readJsonBody(request),
            ),
          );
          return;
        }
        if (request.method === "PATCH" && parts[3] === "category") {
          sendJson(
            response,
            200,
            repository.updateKnowledgeCategory(
              actor,
              parts[2],
              await readJsonBody(request),
            ),
          );
          return;
        }
      }

      if (request.method === "GET" && parts[0] === "operators") {
        sendJson(response, 200, repository.getOperators(actor));
        return;
      }

      if (request.method === "GET" && parts[0] === "gmail" && parts[1] === "status") {
        sendJson(response, 200, repository.getGmailSync(actor));
        return;
      }

      if (request.method === "POST" && parts[0] === "gmail" && parts[1] === "sync") {
        const body = await readJsonBody<{
          label?: string;
          max?: number;
          readonly?: boolean;
          externalSend?: boolean;
        }>(request);
        if (body.externalSend === true) {
          throw new Error("Envio externo deshabilitado para Gmail readonly");
        }
        if (body.readonly === false) {
          throw new Error("Gmail sync solo permite modo readonly");
        }
        sendJson(
          response,
          200,
          await syncAmazonMessagesFromGmail(repository, actor, {
            trigger: "manual",
            labelName: body.label,
            maxMessages: body.max ? Math.min(body.max, 20) : 20,
          }),
        );
        return;
      }

      if (request.method === "POST" && parts[0] === "template") {
        sendJson(
          response,
          201,
          repository.createTemplate(actor, await readJsonBody(request)),
        );
        return;
      }

      if (request.method === "POST" && parts[0] === "classification") {
        sendJson(
          response,
          201,
          repository.addClassification(actor, await readJsonBody(request)),
        );
        return;
      }

      if (request.method === "POST" && parts[0] === "assignment") {
        sendJson(
          response,
          201,
          repository.assignConversation(actor, await readJsonBody(request)),
        );
        return;
      }

      sendJson(response, 404, { message: "Endpoint Amazon Messages no encontrado" });
    } catch (error) {
      const status = isPermissionError(error) ? 403 : 400;
      sendJson(response, status, {
        message:
          error instanceof Error
            ? error.message
            : "Error en Amazon Messages backend",
      });
    }
  });
}

function amazonOutboundModeFromEnv(
  env: Record<string, string | undefined>,
): AmazonOutboundMode {
  const value = env.AMAZON_MESSAGES_OUTBOUND_MODE;
  if (value === "draft_only" || value === "manual_send") return value;
  return "disabled";
}

function assertAllowedValidationRecipient(
  recipient: string | undefined,
  env: Record<string, string | undefined>,
) {
  const allowlist = (env.AMAZON_MESSAGES_FINAL_SEND_ALLOWED_RECIPIENTS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!allowlist.length) {
    throw new Error("Allowlist requerida para validacion real de envio final");
  }
  if (!recipient || !allowlist.includes(recipient.toLowerCase())) {
    throw new Error("Destinatario fuera de allowlist de validacion");
  }
}

function normalizeWorkflowStatusParam(value: string | null) {
  if (
    value === "NUEVO" ||
    value === "PENDIENTE_REVISAR" ||
    value === "EN_REVISION" ||
    value === "LISTO_PARA_RESPONDER" ||
    value === "RESUELTO" ||
    value === "CERRADO"
  ) {
    return value;
  }
  return undefined;
}

export function canAmazonMessagesActor(
  actor: AmazonMessagesActor,
  permission: string,
) {
  return { actor, permission };
}

function isPermissionError(error: unknown) {
  return error instanceof Error && error.message.startsWith("Permiso insuficiente");
}

function sendJson(response: any, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

async function readJsonBody<T>(request: { on: Function }): Promise<T> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", resolve);
    request.on("error", reject);
  });
  if (!chunks.length) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
