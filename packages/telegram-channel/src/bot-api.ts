import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { ChannelContext, InboundFile, OutboundFile } from "@artil/channels/contract";
import { AppError } from "@artil/errors";
import { abortableSleep, minute, second } from "@artil/utils/time";

import type {
  InboundTelegram,
  OutgoingTelegram,
  TelegramEvent,
  TelegramProvider,
  TelegramUpdates,
} from "./provider";

const api = "https://api.telegram.org";

const timeout = 10 * second;

// Files take longer to move than a message.
const fileTimeout = minute;

// How long Telegram holds a request for updates open while none come.
const pollSeconds = 50;

const pollTimeout = (pollSeconds + 10) * second;

const firstRetryDelay = second;

const longestRetryDelay = minute;

// The longest caption a file carries; a longer text goes as a message of its own.
const maxCaption = 1024;

// How long the rest of an album that tagged the bot still comes along: Telegram sends its files one
// right after another.
const albumWindow = minute;

const tokenPattern = /^\d+:[\w\-]+$/v;

const secretHeader = "x-telegram-bot-api-secret-token";

const answerSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  description: z.string().optional(),
});

const botSchema = z.object({ username: z.string().min(1) });

const sentSchema = z.object({ message_id: z.number(), chat: z.object({ id: z.number() }) });

const fileSchema = z.object({
  file_id: z.string(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
  file_size: z.number().optional(),
});

// Where Telegram keeps a file for the bot to download; it gives none for a file too big for bots.
const storedSchema = z.object({ file_path: z.string().optional() });

const userSchema = z.object({
  id: z.number(),
  is_bot: z.boolean(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
});

// A part of a message's text Telegram marks, like an @mention or a /command.
const entitySchema = z.object({ type: z.string(), offset: z.number(), length: z.number() });

const messageSchema = z.object({
  message_id: z.number(),
  from: userSchema.optional(),
  chat: z.object({ id: z.number(), type: z.string(), title: z.string().optional() }),
  text: z.string().optional(),
  caption: z.string().optional(),
  entities: z.array(entitySchema).optional(),
  caption_entities: z.array(entitySchema).optional(),
  // The album a file came in, which Telegram sends one message per file.
  media_group_id: z.string().optional(),
  reply_to_message: z
    .object({
      from: userSchema.optional(),
      text: z.string().optional(),
      caption: z.string().optional(),
    })
    .optional(),
  quote: z.object({ text: z.string() }).optional(),
  document: fileSchema.optional(),
  audio: fileSchema.optional(),
  video: fileSchema.optional(),
  voice: fileSchema.optional(),
  photo: z.array(fileSchema).optional(),
});

const updateSchema = z.object({ message: messageSchema.optional() });

// An update Telegram hands over on request carries its id, to confirm it by asking past it.
const updatesSchema = z.array(updateSchema.extend({ update_id: z.number() }));

type Message = z.infer<typeof messageSchema>;

type User = z.infer<typeof userSchema>;

// The chats where many people write, as Telegram types them.
const groupTypes: ReadonlySet<string> = new Set(["group", "supergroup"]);

type Webhook = { url: string; secret_token: string; allowed_updates: string[] };

type UpdatesRequest = { offset: number; timeout: number; allowed_updates: string[] };

// An answer quotes the message it answers, and still goes when Telegram no longer has that message.
type ReplyParameters = { message_id: number; allow_sending_without_reply: true };

type MessageRequest = {
  chat_id: number | string;
  text: string;
  reply_parameters?: ReplyParameters;
};

type FileRequest = { file_id: string };

type CallOptions<T> = {
  token: string;
  method: string;
  schema: z.ZodType<T>;
  // Files go up as form data, everything else as JSON.
  body?: Webhook | UpdatesRequest | MessageRequest | FileRequest | FormData;
  signal?: AbortSignal;
};

// Where Telegram posts a bot's updates when the server has a public address, under a secret
// only the server can derive for each bot.
type WebhookOptions = { url: string; secret: string };

type Options = {
  // Without a webhook, the server asks Telegram for each bot's updates instead.
  webhook?: WebhookOptions | undefined;
  fetch?: ChannelContext["fetch"];
  // Waits between failed requests to Telegram; tests make it instant.
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

class TelegramError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createBotApi({
  webhook,
  fetch = (url, init) => globalThis.fetch(url, init),
  sleep = abortableSleep,
}: Options = {}): TelegramProvider {
  // The albums in groups that tagged a bot, until when the rest of their files come along.
  const taggedAlbums = new Map<string, number>();

  // In a group, what tags the bot, and the other files of an album that did: Telegram puts the
  // album's caption, and so the tag, on one of them.
  function isForBotInGroup({ bot, message }: IsForBotOptions) {
    const now = Date.now();

    for (const [album, until] of taggedAlbums) if (until <= now) taggedAlbums.delete(album);

    const album =
      message.media_group_id && `${bot.toLowerCase()}:${message.chat.id}:${message.media_group_id}`;

    if (isForBot({ bot, message })) {
      if (album) taggedAlbums.set(album, now + albumWindow);

      return true;
    }

    return album ? taggedAlbums.has(album) : false;
  }

  function secretFor(secret: string, bot: string) {
    return createHmac("sha256", secret).update(bot).digest("base64url");
  }

  async function call<T>({ token, method, schema, body, signal }: CallOptions<T>) {
    const timeoutSignal = AbortSignal.timeout(
      method === "getUpdates" ? pollTimeout : body instanceof FormData ? fileTimeout : timeout,
    );

    const init: RequestInit = {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
      ...(body instanceof FormData
        ? { body }
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }),
    };

    // The token sits in the URL, so an error must not carry the URL along.
    const response = await fetch(`${api}/bot${token}/${method}`, init).catch(() => {
      throw new Error("Telegram could not be reached");
    });

    const answer = answerSchema.safeParse(await response.json().catch(() => null)).data;

    if (!answer?.ok) {
      throw new TelegramError(
        response.status,
        answer?.description ?? `Telegram returned HTTP ${response.status}`,
      );
    }

    return schema.parse(answer.result);
  }

  async function findBot(token: string) {
    if (!tokenPattern.test(token)) throw invalidToken();

    try {
      return await call({ token, method: "getMe", schema: botSchema });
    } catch (cause) {
      if (cause instanceof TelegramError && (cause.status === 401 || cause.status === 404)) {
        throw invalidToken();
      }

      throw cause;
    }
  }

  type PointOptions = { token: string; username: string; at: WebhookOptions };

  async function pointAtServer({ token, username, at }: PointOptions) {
    const url = new URL(at.url);
    url.searchParams.set("bot", username);

    await call({
      token,
      method: "setWebhook",
      schema: z.literal(true),
      body: {
        url: url.href,
        secret_token: secretFor(at.secret, username),
        allowed_updates: ["message"],
      },
    });
  }

  function stopWebhook(token: string) {
    return call({ token, method: "deleteWebhook", schema: z.literal(true) });
  }

  type SendOptions = {
    token: string;
    chat: string;
    text: string;
    reply: ReplyParameters | undefined;
  };

  function sendMessage({ token, chat, text, reply }: SendOptions) {
    return call({
      token,
      method: "sendMessage",
      schema: sentSchema,
      body: {
        chat_id: /^-?\d+$/v.test(chat) ? Number(chat) : chat,
        text,
        ...(reply && { reply_parameters: reply }),
      },
    });
  }

  type SendDocumentsOptions = {
    token: string;
    chat: string;
    files: OutboundFile[];
    caption: string | null;
    reply: ReplyParameters | undefined;
  };

  // Files go as documents, which keep their names and bytes: one alone, several as an album, with
  // the caption under the last.
  async function sendDocuments({ token, chat, files, caption, reply }: SendDocumentsOptions) {
    const form = new FormData();
    form.set("chat_id", chat);

    if (reply) form.set("reply_parameters", JSON.stringify(reply));

    const [only] = files;

    if (only && files.length === 1) {
      form.set("document", new Blob([only.content], { type: only.type }), only.name);

      if (caption) form.set("caption", caption);

      return call({ token, method: "sendDocument", schema: sentSchema, body: form });
    }

    const media = files.map((file, index) => {
      form.set(`file${index}`, new Blob([file.content], { type: file.type }), file.name);

      const last = index === files.length - 1;

      return {
        type: "document",
        media: `attach://file${index}`,
        ...(last && caption && { caption }),
      };
    });

    form.set("media", JSON.stringify(media));

    const [first] = await call({
      token,
      method: "sendMediaGroup",
      schema: z.tuple([sentSchema], sentSchema),
      body: form,
    });

    return first;
  }

  async function deliver({ token, chat, text, files, replyTo }: OutgoingTelegram) {
    const reply = replyParameters(replyTo);

    if (files.length === 0) return sendMessage({ token, chat, text, reply });

    const fits = text.length <= maxCaption;

    // A text too long for a caption goes first, and quotes the message the files then follow.
    if (!fits) await sendMessage({ token, chat, text, reply });

    return sendDocuments({
      token,
      chat,
      files,
      caption: fits ? text : null,
      reply: fits ? reply : undefined,
    });
  }

  type DownloadOptions = { token: string; fileId: string };

  // A bot downloads what people send it at a link that holds its token, up to 20 MB a file.
  async function download({ token, fileId }: DownloadOptions) {
    const stored = await call({
      token,
      method: "getFile",
      schema: storedSchema,
      body: { file_id: fileId },
    }).catch((cause: unknown) => {
      // Telegram refuses a file a bot may not download, and asking again would not change that.
      if (cause instanceof TelegramError && cause.status === 400) return null;

      throw cause;
    });

    if (!stored?.file_path) return null;

    // The token sits in the URL, so an error must not carry the URL along.
    const response = await fetch(`${api}/file/bot${token}/${stored.file_path}`, {
      signal: AbortSignal.timeout(fileTimeout),
    }).catch(() => {
      throw new Error("Telegram could not be reached");
    });

    if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status} for a file`);

    return new Uint8Array(await response.arrayBuffer());
  }

  type FilesOfOptions = { message: Message; token: string | null };

  // A message's files with their bytes, while the bot is connected and Telegram hands them over.
  function filesOf({ message, token }: FilesOfOptions) {
    return Promise.all(
      describeFiles(message).map(async ({ fileId, ...file }): Promise<InboundFile> => {
        const content = token ? await download({ token, fileId }) : null;

        return { ...file, size: content?.byteLength ?? file.size, content };
      }),
    );
  }

  type ReadOptions = { bot: string; message: Message | undefined; token: string | null };

  // A private chat with the bot reaches the account, and in a group what tags the bot or answers it.
  async function read({ bot, message, token }: ReadOptions): Promise<TelegramEvent[]> {
    const from = message?.from;

    if (!message || !from) return [];

    const inGroup = groupTypes.has(message.chat.type);
    const forBot = inGroup ? isForBotInGroup({ bot, message }) : message.chat.type === "private";

    if (!forBot) return [];

    const files = await filesOf({ message, token });

    return [{ type: "received", message: toInbound({ bot, message, from, inGroup, files }) }];
  }

  function verify(request: Request) {
    const bot = new URL(request.url).searchParams.get("bot");
    const secret = request.headers.get(secretHeader);

    if (!webhook || !bot || !secret || !sameSecret(secret, secretFor(webhook.secret, bot))) {
      throw new AppError({ code: "unauthorized", message: "Invalid webhook secret" });
    }

    return bot;
  }

  // Keeps the bot's updates coming, trying again after each failure until the signal aborts. With
  // a webhook, Telegram posts them once it takes the webhook; without one, the server asks for them.
  async function start({ token, signal, onEvents, onError }: TelegramUpdates) {
    let offset = 0;
    let retryDelay = firstRetryDelay;
    // The bot's username, once Telegram hands its updates out.
    let polledBot: string | undefined;

    while (!signal.aborted) {
      try {
        if (!polledBot) {
          const { username } = await findBot(token);

          if (webhook) {
            await pointAtServer({ token, username, at: webhook });

            return;
          }

          // A bot hands its updates out only while no webhook takes them.
          await stopWebhook(token);
          polledBot = username;
        }

        const updates = await call({
          token,
          method: "getUpdates",
          schema: updatesSchema,
          body: { offset, timeout: pollSeconds, allowed_updates: ["message"] },
          signal,
        });

        const bot = polledBot;

        const events = await Promise.all(
          updates.map(({ message }) => read({ bot, message, token })),
        );

        await onEvents(events.flat());

        const last = updates.at(-1);

        if (last) offset = last.update_id + 1;

        retryDelay = firstRetryDelay;
      } catch (cause) {
        if (signal.aborted) return;

        onError(cause);
        await sleep(retryDelay, signal);
        retryDelay = Math.min(retryDelay * 2, longestRetryDelay);
      }
    }
  }

  return {
    connect: async (token) => (await findBot(token)).username,

    disconnect: async (token) => {
      await stopWebhook(token);
    },

    verifyEvents: async (request, tokenOf) => {
      const bot = verify(request);
      const update = updateSchema.safeParse(await request.json().catch(() => null));

      if (!update.success) {
        throw new AppError({ code: "invalid_input", message: "Invalid Telegram update" });
      }

      const { message } = update.data;
      const token = message && describeFiles(message).length > 0 ? await tokenOf(bot) : null;

      return read({ bot, message, token });
    },

    start,

    send: async (message) => {
      const sent = await deliver(message).catch((cause: unknown) => {
        throw isBotToBotDisabled(cause) ? new Error(botToBotDisabled) : cause;
      });

      return { id: idOf(sent.chat.id, sent.message_id) };
    },
  };
}

const botToBotDisabled =
  "Telegram passes messages between bots only when both turn on Bot-to-Bot Communication Mode in @BotFather";

function isBotToBotDisabled(cause: unknown) {
  return cause instanceof TelegramError && cause.message.includes("BOT_TO_BOT_DISABLED");
}

// A message's id in Artil: Telegram numbers a bot's messages in each chat on its own.
function idOf(chat: number, messageId: number) {
  return `${chat}:${messageId}`;
}

// What the answer quotes: the message's id in the chat it goes to, from the id Artil gave it.
function replyParameters(replyTo: string | null): ReplyParameters | undefined {
  const messageId = /^-?\d+:(\d+)$/v.exec(replyTo ?? "")?.[1];

  return messageId
    ? { message_id: Number(messageId), allow_sending_without_reply: true }
    : undefined;
}

function invalidToken() {
  return new AppError({ code: "invalid_input", message: "Telegram does not know that bot token" });
}

function sameSecret(given: string, expected: string) {
  return timingSafeEqual(digest(given), digest(expected));
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

type IsForBotOptions = { bot: string; message: Message };

// What tags the bot, as @bot or /command@bot, or answers one of its messages, in any case.
function isForBot({ bot, message }: IsForBotOptions) {
  const username = bot.toLowerCase();
  const answered = message.reply_to_message?.from;

  if (answered?.is_bot && answered.username?.toLowerCase() === username) return true;

  const text = message.text ?? message.caption ?? "";
  const entities = message.entities ?? message.caption_entities ?? [];

  // Telegram counts offsets in UTF-16 code units, as JavaScript strings do.
  return entities.some(({ type, offset, length }) => {
    const tag = text.slice(offset, offset + length).toLowerCase();

    return (
      (type === "mention" && tag === `@${username}`) ||
      (type === "bot_command" && tag.endsWith(`@${username}`))
    );
  });
}

type ToInboundOptions = {
  bot: string;
  message: Message;
  from: User;
  inGroup: boolean;
  files: InboundFile[];
};

function toInbound({ bot, message, from, inGroup, files }: ToInboundOptions): InboundTelegram {
  const { message_id, chat, text, caption } = message;

  return {
    id: idOf(chat.id, message_id),
    bot,
    chat: String(chat.id),
    group: inGroup ? { title: chat.title ?? null } : null,
    senderId: String(from.id),
    fromBot: from.is_bot ? (from.username ?? null) : null,
    username: from.is_bot ? null : (from.username ?? null),
    fromName: nameOf(from),
    text: text ?? caption ?? "",
    files,
    quote: quoteOf(message),
  };
}

function nameOf(user: User | undefined) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(" ") || null;
}

function quoteOf({ reply_to_message: reply, quote }: Message) {
  const text = quote?.text ?? reply?.text ?? reply?.caption;

  return text ? { fromName: nameOf(reply?.from), text } : null;
}

type File = z.infer<typeof fileSchema>;

// Telegram names few files, so each kind of file has a name and type to fall back on.
function describeFiles({ document, audio, video, voice, photo }: Message) {
  const files: [File | undefined, string, string][] = [
    [document, "document", "application/octet-stream"],
    [audio, "audio", "audio/mpeg"],
    [video, "video.mp4", "video/mp4"],
    [voice, "voice.ogg", "audio/ogg"],
    // A photo comes in several sizes, the largest last.
    [photo?.at(-1), "photo.jpg", "image/jpeg"],
  ];

  return files.flatMap(([file, name, type]) =>
    file
      ? [
          {
            fileId: file.file_id,
            name: file.file_name ?? name,
            type: file.mime_type ?? type,
            size: file.file_size ?? 0,
          },
        ]
      : [],
  );
}
