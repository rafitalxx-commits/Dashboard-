export type GmailReadonlyConfig = {
  account: string;
  labelName: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  maxMessages: number;
};

export type GmailDraftConfig = {
  account: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
};

export type GmailReadonlyMessage = {
  id: string;
  threadId?: string;
  historyId?: string;
  rawEmail: string;
};

export type GmailReadonlySource = {
  listLabelMessages: (input: {
    labelName: string;
    maxMessages: number;
    after?: string;
  }) => Promise<{
    labelId: string;
    messages: GmailReadonlyMessage[];
  }>;
};

type GogCliMessage = {
  id: string;
  threadId?: string;
  date?: string;
  from?: string;
  subject?: string;
  body?: string;
};

type GogCliSearchResult = {
  messages?: GogCliMessage[];
};

type GogCliRunner = (
  args: string[],
  env: Record<string, string | undefined>,
) => Promise<string>;

export type GmailDraftInput = {
  gmailDraftId?: string;
  to: string;
  subject: string;
  bodyText: string;
  threadId?: string;
};

export type GmailDraftResult = {
  id: string;
  messageId?: string;
  threadId?: string;
};

export type GmailDraftSource = {
  createOrUpdateDraft: (input: GmailDraftInput) => Promise<GmailDraftResult>;
};

export type GmailFinalDraftSendInput = {
  gmailDraftId: string;
};

export type GmailFinalDraftSendResult = {
  draftId: string;
  sentMessageId: string;
  threadId?: string;
};

export type GmailFinalDraftSendSource = {
  sendExistingDraft: (
    input: GmailFinalDraftSendInput,
  ) => Promise<GmailFinalDraftSendResult>;
};

type GmailApiLabel = {
  id: string;
  name: string;
};

type GmailApiMessageListItem = {
  id: string;
  threadId?: string;
};

type GmailApiRawMessage = {
  id: string;
  threadId?: string;
  historyId?: string;
  raw?: string;
};

export function gmailReadonlyConfigFromEnv(
  env: Record<string, string | undefined>,
): GmailReadonlyConfig {
  return {
    account: env.AMAZON_MESSAGES_GMAIL_ACCOUNT ?? "juanitoopenclaw@gmail.com",
    labelName: env.AMAZON_MESSAGES_GMAIL_LABEL ?? "AmazonSeller",
    clientId: env.GMAIL_CLIENT_ID ?? env.GOOGLE_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET ?? env.GOOGLE_CLIENT_SECRET,
    refreshToken:
      env.AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN ?? env.GMAIL_REFRESH_TOKEN,
    maxMessages: Number(env.AMAZON_MESSAGES_GMAIL_MAX_MESSAGES ?? 100),
  };
}

export function gmailDraftConfigFromEnv(
  env: Record<string, string | undefined>,
): GmailDraftConfig {
  return {
    account:
      env.AMAZON_MESSAGES_GMAIL_DRAFT_ACCOUNT ??
      env.AMAZON_MESSAGES_GMAIL_ACCOUNT ??
      "juanitoopenclaw@gmail.com",
    clientId:
      env.AMAZON_MESSAGES_GMAIL_DRAFT_CLIENT_ID ??
      env.GMAIL_CLIENT_ID ??
      env.GOOGLE_CLIENT_ID,
    clientSecret:
      env.AMAZON_MESSAGES_GMAIL_DRAFT_CLIENT_SECRET ??
      env.GMAIL_CLIENT_SECRET ??
      env.GOOGLE_CLIENT_SECRET,
    refreshToken:
      env.AMAZON_MESSAGES_GMAIL_DRAFT_REFRESH_TOKEN ??
      env.AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN ??
      env.GMAIL_REFRESH_TOKEN,
  };
}

export function createGmailApiReadonlySource(
  config: GmailReadonlyConfig,
): GmailReadonlySource {
  return {
    async listLabelMessages({ labelName, maxMessages, after }) {
      validateGmailConfig(config);
      const accessToken = await getAccessToken(config);
      const labelId = await getLabelId(accessToken, labelName);
      const query = after ? `after:${Math.floor(new Date(after).getTime() / 1000)}` : "";
      const search = new URLSearchParams({
        labelIds: labelId,
        maxResults: String(maxMessages),
      });
      if (query) search.set("q", query);

      const list = await gmailFetch<{
        messages?: GmailApiMessageListItem[];
      }>(accessToken, `/gmail/v1/users/me/messages?${search.toString()}`);

      const messages = await Promise.all(
        (list.messages ?? []).map(async (message) => {
          const raw = await gmailFetch<GmailApiRawMessage>(
            accessToken,
            `/gmail/v1/users/me/messages/${message.id}?format=raw`,
          );
          return {
            id: raw.id,
            threadId: raw.threadId ?? message.threadId,
            historyId: raw.historyId,
            rawEmail: decodeBase64Url(required(raw.raw, "raw")),
          };
        }),
      );

      return { labelId, messages };
    },
  };
}

export function createGogCliReadonlySource(
  config: GmailReadonlyConfig,
  runner: GogCliRunner = runGogCli,
): GmailReadonlySource {
  return {
    async listLabelMessages({ labelName, maxMessages, after }) {
      const queryParts = [`label:${labelName}`];
      if (after) queryParts.push(`after:${formatGmailSearchDate(after)}`);
      const gogHome =
        process.env.AMAZON_MESSAGES_GOG_HOME ??
        process.env.GOG_HOME ??
        process.env.HOME ??
        "/root";
      const output = await runner(
        [
          "gmail",
          "messages",
          "search",
          queryParts.join(" "),
          "--max",
          String(maxMessages),
          "--full",
          "--json",
          "--no-input",
          "--gmail-no-send",
        ],
        {
          ...process.env,
          HOME: gogHome,
          GOG_ACCOUNT: config.account,
          GOG_KEYRING_PASSWORD:
            process.env.GOG_KEYRING_PASSWORD ??
            (await readGogKeyringPassword(gogHome)),
        },
      );
      const payload = JSON.parse(output) as GogCliSearchResult;
      return {
        labelId: labelName,
        messages: (payload.messages ?? []).map((message) => ({
          id: message.id,
          threadId: message.threadId,
          rawEmail: buildRawEmailFromGogMessage(config.account, message),
        })),
      };
    },
  };
}

async function readGogKeyringPassword(home: string) {
  try {
    const { readFile } = await import("node:fs/promises");
    return (await readFile(`${home}/.config/gogcli/keyring-password`, "utf8")).trim();
  } catch {
    return undefined;
  }
}

export function createGmailReadonlySourceWithGogFallback(
  config: GmailReadonlyConfig,
): GmailReadonlySource {
  const apiSource = createGmailApiReadonlySource(config);
  const gogSource = createGogCliReadonlySource(config);
  return {
    async listLabelMessages(input) {
      try {
        return await apiSource.listLabelMessages(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          !/invalid_grant|expired|revoked|Faltan credenciales Gmail OAuth readonly|Campo Gmail requerido/i.test(
            message,
          )
        ) {
          throw error;
        }
        return gogSource.listLabelMessages(input);
      }
    },
  };
}

export function createGmailApiDraftSource(
  config: GmailDraftConfig,
): GmailDraftSource {
  return {
    async createOrUpdateDraft(input) {
      validateGmailDraftConfig(config);
      const accessToken = await getAccessToken(config);
      const raw = encodeBase64Url(
        buildDraftMime({
          account: config.account,
          to: input.to,
          subject: input.subject,
          bodyText: input.bodyText,
        }),
      );
      const payload = {
        message: {
          raw,
          threadId: input.threadId,
        },
      };
      const draft = input.gmailDraftId
        ? await gmailFetch<GmailApiDraft>(
            accessToken,
            `/gmail/v1/users/me/drafts/${encodeURIComponent(input.gmailDraftId)}`,
            {
              method: "PUT",
              body: JSON.stringify(payload),
            },
          )
        : await gmailFetch<GmailApiDraft>(accessToken, "/gmail/v1/users/me/drafts", {
            method: "POST",
            body: JSON.stringify(payload),
          });
      return {
        id: required(draft.id, "gmailDraftId"),
        messageId: draft.message?.id,
        threadId: draft.message?.threadId,
      };
    },
  };
}

export function createGmailApiFinalDraftSendSource(
  config: GmailDraftConfig,
): GmailFinalDraftSendSource {
  return {
    async sendExistingDraft(input) {
      validateGmailDraftConfig(config);
      if (!input.gmailDraftId) {
        throw new Error("Gmail Draft existente requerido para finalizar");
      }
      const accessToken = await getAccessToken(config);
      const result = await gmailFetch<GmailApiSentMessage>(
        accessToken,
        "/gmail/v1/users/me/drafts/send",
        {
          method: "POST",
          body: JSON.stringify({ id: input.gmailDraftId }),
        },
      );
      return {
        draftId: input.gmailDraftId,
        sentMessageId: required(result.id, "sentMessageId"),
        threadId: result.threadId,
      };
    },
  };
}

export function explainMissingGmailSetup(config: GmailReadonlyConfig) {
  const missing = [
    [
      "AMAZON_MESSAGES_GMAIL_DRAFT_CLIENT_ID or GMAIL_CLIENT_ID or GOOGLE_CLIENT_ID",
      config.clientId,
    ],
    [
      "AMAZON_MESSAGES_GMAIL_DRAFT_CLIENT_SECRET or GMAIL_CLIENT_SECRET or GOOGLE_CLIENT_SECRET",
      config.clientSecret,
    ],
    [
      "AMAZON_MESSAGES_GMAIL_DRAFT_REFRESH_TOKEN or AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN or GMAIL_REFRESH_TOKEN",
      config.refreshToken,
    ],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (!missing.length) return undefined;
  return `Faltan credenciales Gmail OAuth readonly: ${missing.join(", ")}`;
}

export function explainMissingGmailDraftSetup(config: GmailDraftConfig) {
  const missing = [
    ["GMAIL_CLIENT_ID or GOOGLE_CLIENT_ID", config.clientId],
    ["GMAIL_CLIENT_SECRET or GOOGLE_CLIENT_SECRET", config.clientSecret],
    [
      "AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN or GMAIL_REFRESH_TOKEN",
      config.refreshToken,
    ],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (!missing.length) return undefined;
  return `Faltan credenciales Gmail OAuth compose: ${missing.join(", ")}`;
}

async function getAccessToken(config: GmailReadonlyConfig | GmailDraftConfig) {
  const body = new URLSearchParams({
    client_id: required(config.clientId, "clientId"),
    client_secret: required(config.clientSecret, "clientSecret"),
    refresh_token: required(config.refreshToken, "refreshToken"),
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ??
        payload.error ??
        "No se pudo obtener access token Gmail",
    );
  }
  return payload.access_token;
}

async function runGogCli(
  args: string[],
  env: Record<string, string | undefined>,
) {
  const { execFile } = await import("node:child_process");
  const gogBin =
    process.env.GOG_BIN ??
    process.env.AMAZON_MESSAGES_GOG_BIN ??
    "/home/linuxbrew/.linuxbrew/bin/gog";
  return new Promise<string>((resolve, reject) => {
    execFile(
      gogBin,
      args,
      { env, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function buildRawEmailFromGogMessage(account: string, message: GogCliMessage) {
  const contentType = /<html[\s>]/i.test(message.body ?? "")
    ? "text/html"
    : "text/plain";
  return [
    `Message-ID: <gog-${message.id}@gmail.local>`,
    `From: ${message.from ?? "Amazon <donotreply@amazon.com>"}`,
    `To: ${account}`,
    `Subject: ${message.subject ?? ""}`,
    `Date: ${message.date ?? new Date().toUTCString()}`,
    `Content-Type: ${contentType}; charset=UTF-8`,
    "",
    message.body ?? "",
  ].join("\r\n");
}

function formatGmailSearchDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

async function getLabelId(accessToken: string, labelName: string) {
  const payload = await gmailFetch<{ labels?: GmailApiLabel[] }>(
    accessToken,
    "/gmail/v1/users/me/labels",
  );
  const label = payload.labels?.find(
    (item) => item.name.toLowerCase() === labelName.toLowerCase(),
  );
  if (!label) {
    throw new Error(
      `No existe la etiqueta Gmail "${labelName}". Crear una etiqueta con ese nombre y filtrar ahi los correos Amazon.`,
    );
  }
  return label.id;
}

async function gmailFetch<T>(accessToken: string, path: string): Promise<T>;
async function gmailFetch<T>(
  accessToken: string,
  path: string,
  init: RequestInit,
): Promise<T>;
async function gmailFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Error leyendo Gmail API");
  }
  return payload;
}

function validateGmailConfig(config: GmailReadonlyConfig) {
  const missing = explainMissingGmailSetup(config);
  if (missing) throw new Error(missing);
}

function validateGmailDraftConfig(config: GmailDraftConfig) {
  const missing = explainMissingGmailDraftSetup(config);
  if (missing) throw new Error(missing);
}

function decodeBase64Url(value: string) {
  return Buffer.from(
    value.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildDraftMime(input: {
  account: string;
  to: string;
  subject: string;
  bodyText: string;
}) {
  const headers = [
    `From: ${input.account}`,
    `To: ${input.to}`,
    `Subject: ${encodeMimeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${input.bodyText}`;
}

function encodeMimeHeader(value: string) {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

type GmailApiDraft = {
  id?: string;
  message?: {
    id?: string;
    threadId?: string;
  };
};

type GmailApiSentMessage = {
  id?: string;
  threadId?: string;
};

function required(value: string | undefined, field: string) {
  if (!value) throw new Error(`Campo Gmail requerido: ${field}`);
  return value;
}
