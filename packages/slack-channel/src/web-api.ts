import { z } from "zod";

import type { InboundFile, OutboundFile } from "@artil/channels/contract";
import { AppError } from "@artil/errors";
import { minute, second } from "@artil/utils/time";

import { channelAddress, isDirectMessage, isEmail, isPerson } from "./conversations";
import type {
  OutgoingSlack,
  SlackEvent,
  SlackPerson,
  SlackQuote,
  SlackProvider,
  SlackTokens,
  SlackUpdates,
} from "./provider";

const api = "https://slack.com/api";

const timeout = 10 * second;

// Files take longer to move than a message.
const fileTimeout = minute;

// The most of a thread a mention carries above its text.
const maxQuotes = 20;

// The largest file the server downloads, since it holds each whole in memory; a larger one comes
// described, without its bytes.
const maxDownload = 20_000_000;

const answerSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  // The scope a method needs that the app was not given.
  needed: z.string().optional(),
});

const botSchema = z.object({ user_id: z.string(), user: z.string(), bot_id: z.string() });

const botInfoSchema = z.object({ bot: z.object({ app_id: z.string() }) });

const connectionSchema = z.object({ url: z.string() });

// How Slack greets a Socket Mode connection, naming the app it is for.
const helloSchema = z.object({
  type: z.literal("hello"),
  connection_info: z.object({ app_id: z.string() }),
});

const openedSchema = z.object({ channel: z.object({ id: z.string() }) });

const postedSchema = z.object({ ts: z.string() });

const uploadSchema = z.object({ upload_url: z.string(), file_id: z.string() });

const userSchema = z.object({
  user: z.object({
    name: z.string(),
    real_name: z.string().optional(),
    is_bot: z.boolean().optional(),
    profile: z.object({ email: z.string().optional() }).optional(),
  }),
});

const memberSchema = z.object({ user: z.object({ id: z.string() }) });

const channelsSchema = z.object({
  channels: z.array(z.object({ id: z.string(), name: z.string() })),
});

const conversationSchema = z.object({ channel: z.object({ name: z.string() }) });

// A message in a thread: by a person, or by an app that has no member id.
const replySchema = z.object({
  user: z.string().optional(),
  bot_profile: z.object({ name: z.string() }).optional(),
  text: z.string(),
});

// A page of a thread's messages, oldest first, and where the next page starts.
const repliesSchema = z.object({
  messages: z.array(replySchema),
  response_metadata: z.object({ next_cursor: z.string() }).optional(),
});

const fileSchema = z.object({
  name: z.string().optional(),
  mimetype: z.string().optional(),
  size: z.number().optional(),
  // Where the bot downloads the file; Slack gives none for a file it no longer shows.
  url_private_download: z.string().optional(),
});

const eventSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  channel: z.string().optional(),
  user: z.string().optional(),
  text: z.string().optional(),
  ts: z.string().optional(),
  // The timestamp of the message that starts the thread this one is in.
  thread_ts: z.string().optional(),
  files: z.array(fileSchema).optional(),
});

// What Slack sends over Socket Mode: a greeting, an envelope it waits for the server to
// acknowledge, or a request to connect again.
const envelopeSchema = z.object({
  type: z.string(),
  envelope_id: z.string().optional(),
  payload: z.unknown().optional(),
});

const payloadSchema = z.object({ event: eventSchema });

type Event = z.infer<typeof eventSchema>;

type Reply = z.infer<typeof replySchema>;

type File = z.infer<typeof fileSchema>;

// The messages people write, as Slack types them: plain, with files, or a reply in a thread that
// shows in the channel too. Edits, deletions and the like are not.
const writtenSubtypes: ReadonlySet<string | undefined> = new Set([
  undefined,
  "file_share",
  "thread_broadcast",
]);

// A method's arguments, which Slack takes as a form; one that is a list goes as JSON.
type Params = Record<string, string | undefined>;

type CallOptions<T> = { token: string; method: string; schema: z.ZodType<T>; params?: Params };

type Options = {
  // Tests swap it for a fake Slack.
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  // How often the server pings Slack over Socket Mode; tests make it quick.
  heartbeat?: number;
};

// A call Slack refused, with its reason, like invalid_auth.
class SlackError extends Error {}

export function createWebApi({
  fetch = (url, init) => globalThis.fetch(url, init),
  heartbeat = 30 * second,
}: Options = {}): SlackProvider {
  async function call<T>({ token, method, schema, params = {} }: CallOptions<T>) {
    const form = new URLSearchParams();

    for (const [name, value] of Object.entries(params)) if (value) form.set(name, value);

    const response = await fetch(`${api}/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(timeout),
    }).catch((cause: unknown) => {
      throw new Error("Slack could not be reached", { cause });
    });

    const body: unknown = await response.json().catch(() => null);
    const answer = answerSchema.safeParse(body).data;

    if (!answer?.ok) {
      const reason = answer?.error ?? `Slack returned HTTP ${response.status}`;

      throw new SlackError(
        answer?.needed ? `${reason}: the Slack app needs the ${answer.needed} scope` : reason,
      );
    }

    return schema.parse(body);
  }

  type CheckTokenOptions<T> = { request: Promise<T>; name: string };

  // A call Slack refuses tells whoever connects the app which of its tokens it refused.
  async function checkToken<T>({ request, name }: CheckTokenOptions<T>) {
    try {
      return await request;
    } catch (cause) {
      if (!(cause instanceof SlackError)) throw cause;

      throw new AppError({
        code: "invalid_input",
        message: `Slack refused the ${name}: ${cause.message}`,
        cause,
      });
    }
  }

  // The app a Socket Mode connection is for, as Slack names it when it greets the connection.
  async function appOfConnection(url: string) {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const socket = new WebSocket(url);

    const timer = setTimeout(
      () => reject(new Error("Slack did not greet the connection")),
      timeout,
    );

    socket.addEventListener("message", ({ data }) => {
      try {
        const hello = helloSchema.safeParse(JSON.parse(z.string().parse(data))).data;

        if (hello) resolve(hello.connection_info.app_id);
      } catch (cause) {
        reject(cause);
      }
    });

    socket.addEventListener("close", () => reject(new Error("Slack closed the connection")));
    socket.addEventListener("error", () => reject(new Error("Slack could not be reached")));

    try {
      return await promise;
    } finally {
      clearTimeout(timer);
      socket.close();
    }
  }

  // Checks both tokens, and that they are one app's, and returns the bot's username.
  async function connect({ bot, app }: SlackTokens) {
    const { user: username, bot_id: botId } = await checkToken({
      request: call({ token: bot, method: "auth.test", schema: botSchema }),
      name: "bot token",
    });

    // Opening a connection checks the app-level token and that the app has Socket Mode on.
    const { url } = await checkToken({
      request: call({ token: app, method: "apps.connections.open", schema: connectionSchema }),
      name: "app-level token",
    });

    const [{ bot: found }, connectionApp] = await Promise.all([
      call({ token: bot, method: "bots.info", schema: botInfoSchema, params: { bot: botId } }),
      appOfConnection(url),
    ]);

    // Tokens of two apps would read one app's messages and answer them as the other's bot.
    if (connectionApp !== found.app_id) {
      throw new AppError({
        code: "invalid_input",
        message:
          "The bot token and the app-level token belong to different Slack apps; give both of one app",
      });
    }

    return username;
  }

  type PersonOfOptions = { token: string; user: string };

  // Who a person is, by their member id; only that when Slack does not tell more.
  async function personOf({ token, user }: PersonOfOptions): Promise<SlackPerson> {
    const found = await call({
      token,
      method: "users.info",
      schema: userSchema,
      params: { user },
    }).catch(() => null);

    return {
      id: user,
      name: found ? found.user.real_name || found.user.name : null,
      email: found?.user.profile?.email ?? null,
      bot: found?.user.is_bot ? found.user.name : null,
    };
  }

  type GroupOfOptions = { token: string; channel: string };

  // A channel by its id and its name, when Slack tells it.
  async function groupOf({ token, channel }: GroupOfOptions) {
    const found = await call({
      token,
      method: "conversations.info",
      schema: conversationSchema,
      params: { channel },
    }).catch(() => null);

    return { id: channel, name: found?.channel.name ?? null };
  }

  type DownloadOptions = { token: string; url: string; type: string };

  // A bot downloads what people send it with its token. Slack has the message as delivered by then,
  // so a file it does not hand over comes described, without its bytes, rather than holding the
  // message back.
  async function download({ token, url, type }: DownloadOptions) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(fileTimeout),
      });

      // Slack answers a bot without the files:read scope with its sign-in page.
      const signInPage =
        response.headers.get("content-type")?.startsWith("text/html") &&
        !type.startsWith("text/html");

      if (!response.ok || signInPage) return null;

      return new Uint8Array(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  type FilesOfOptions = { token: string; files: File[] };

  // A message's files with their bytes, while Slack hands them over.
  function filesOf({ token, files }: FilesOfOptions) {
    return Promise.all(
      files.map(async (file): Promise<InboundFile> => {
        const type = file.mimetype ?? "application/octet-stream";
        const size = file.size ?? 0;
        const url = file.url_private_download;
        const content = url && size <= maxDownload ? await download({ token, url, type }) : null;

        return { name: file.name ?? "file", type, size: content?.byteLength ?? size, content };
      }),
    );
  }

  type ThreadBeforeOptions = { token: string; channel: string; thread: string; ts: string };

  // A thread's messages before one in it, oldest first, a page at a time.
  async function threadBefore({ token, channel, thread, ts }: ThreadBeforeOptions) {
    const messages: Reply[] = [];
    let cursor = "";

    do {
      const page = await call({
        token,
        method: "conversations.replies",
        schema: repliesSchema,
        params: { channel, ts: thread, latest: ts, limit: "999", cursor },
      });

      messages.push(...page.messages);
      cursor = page.response_metadata?.next_cursor ?? "";
    } while (cursor);

    return messages;
  }

  type QuotesOfOptions = ThreadBeforeOptions & { botId: string };

  // What was said in a thread before a mention, since the bot last wrote there, which the bot does
  // not hear otherwise; none when Slack does not hand the thread over.
  async function quotesOf({ token, botId, channel, thread, ts }: QuotesOfOptions) {
    const messages = await threadBefore({ token, channel, thread, ts }).catch(() => []);
    const unheard = messages.slice(messages.findLastIndex(({ user }) => user === botId) + 1);
    const quoted = unheard.filter(({ text }) => text).slice(-maxQuotes);
    const people = new Set(quoted.flatMap(({ user }) => (user ? [user] : [])));

    const names = new Map(
      await Promise.all(
        [...people].map(async (user) => [user, (await personOf({ token, user })).name] as const),
      ),
    );

    return quoted.map(({ user, bot_profile: app, text }): SlackQuote => ({
      fromName: (user ? names.get(user) : app?.name) ?? null,
      text: unescaped(text),
    }));
  }

  // The bot by its member id, which its own messages come from, and its username.
  type Bot = { id: string; username: string };

  type ReadOptions = { bot: Bot; token: string; event: Event };

  // A direct message with the bot reaches the account, and in a channel what mentions the bot.
  // Slack sends the first as a message and the second as an app_mention; in a direct message only
  // the message counts, so a mention there comes once.
  async function read({ bot, token, event }: ReadOptions): Promise<SlackEvent[]> {
    const { type, subtype, channel, user, ts, thread_ts: threadTs } = event;

    if (!channel || !user || !ts || user === bot.id || !writtenSubtypes.has(subtype)) return [];

    const direct = isDirectMessage(channel);

    if (type !== (direct ? "message" : "app_mention")) return [];

    // A direct message brings the bot every message, and a channel only the mentions.
    const inChannelThread = !direct && threadTs && threadTs !== ts;

    const [sender, group, files, quotes] = await Promise.all([
      personOf({ token, user }),
      direct ? null : groupOf({ token, channel }),
      filesOf({ token, files: event.files ?? [] }),
      inChannelThread ? quotesOf({ token, botId: bot.id, channel, thread: threadTs, ts }) : [],
    ]);

    return [
      {
        type: "received",
        message: {
          id: idOf({ conversation: channel, ts }),
          bot: bot.username,
          group,
          sender,
          text: unescaped(event.text ?? ""),
          files,
          quotes,
          thread: idOf({ conversation: channel, ts: threadTs ?? ts }),
        },
      },
    ];
  }

  type ListenOptions = {
    url: string;
    signal: AbortSignal;
    onEvent: (event: Event) => Promise<void>;
  };

  // Takes what Slack sends over one Socket Mode connection. Each envelope is acknowledged as it
  // comes, within the three seconds Slack waits, and its event taken after, in order, so a slow
  // download holds nothing up. Ends once the events Slack has as delivered are taken, when Slack
  // asks for a new connection or the signal aborts, and fails when the connection drops or the
  // server cannot take an event.
  function listen({ url, signal, onEvent }: ListenOptions) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = new WebSocket(url);
    let open = true;
    let heard = true;
    let taking = Promise.resolve();

    // Slack answers each ping. A connection that stays silent a whole beat is dead, as after the
    // computer slept, and the server opens another.
    const beat = setInterval(() => {
      if (!heard) return end(new Error("Slack stopped answering"));

      heard = false;

      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }, heartbeat);

    // Only the first end counts: closing the socket ends it again.
    function end(cause?: unknown) {
      if (!open) return;

      open = false;
      clearInterval(beat);
      signal.removeEventListener("abort", stop);
      socket.close();
      void taking.then(() => (cause ? reject(cause) : resolve()));
    }

    function stop() {
      end();
    }

    // Takes what Slack sends: a request to connect again, or an envelope, which it acknowledges at
    // once and whose event it queues.
    function take(data: string) {
      const { type, envelope_id: envelopeId, payload } = envelopeSchema.parse(JSON.parse(data));

      if (type === "disconnect") return end();

      if (!envelopeId) return;

      socket.send(JSON.stringify({ envelope_id: envelopeId }));

      const event = type === "events_api" ? payloadSchema.safeParse(payload).data?.event : null;

      if (event) taking = taking.then(() => onEvent(event)).catch(end);
    }

    signal.addEventListener("abort", stop, { once: true });

    socket.addEventListener("pong", () => {
      heard = true;
    });

    socket.addEventListener("message", ({ data }) => {
      heard = true;

      if (!open) return;

      try {
        take(z.string().parse(data));
      } catch (cause) {
        end(cause);
      }
    });

    socket.addEventListener("close", () => end(new Error("Slack closed the connection")));
    socket.addEventListener("error", () => end(new Error("Slack could not be reached")));

    if (signal.aborted) end();

    return promise;
  }

  // Keeps the bot's messages coming over Socket Mode until the signal aborts, on a new connection
  // each time Slack asks for one. A failure ends it, and the server starts it again.
  async function start({ tokens, signal, onEvents }: SlackUpdates) {
    const { user_id: id, user: username } = await call({
      token: tokens.bot,
      method: "auth.test",
      schema: botSchema,
    });

    const bot = { id, username };

    while (!signal.aborted) {
      const { url } = await call({
        token: tokens.app,
        method: "apps.connections.open",
        schema: connectionSchema,
      });

      await listen({
        url,
        signal,
        onEvent: async (event) => onEvents(await read({ bot, token: tokens.bot, event })),
      });
    }
  }

  type ChannelNamedOptions = { token: string; name: string };

  // A channel by its #name, among the channels the bot is in, which are the ones it may write to.
  async function channelNamed({ token, name }: ChannelNamedOptions) {
    const { channels } = await call({
      token,
      method: "users.conversations",
      schema: channelsSchema,
      params: { types: "public_channel,private_channel", exclude_archived: "true", limit: "999" },
    });

    const named = channels.find((channel) => channelAddress(channel.name) === name);

    if (!named) throw new Error(`The bot is not in ${name}; invite it there with /invite`);

    return named.id;
  }

  type MemberByEmailOptions = { token: string; email: string };

  async function memberByEmail({ token, email }: MemberByEmailOptions) {
    const { user } = await call({
      token,
      method: "users.lookupByEmail",
      schema: memberSchema,
      params: { email },
    });

    return user.id;
  }

  type ConversationOfOptions = { token: string; to: string };

  // The conversation a recipient names: a channel by its id or #name, or a person's direct message,
  // by their member id or email, which Slack opens when it has to.
  async function conversationOf({ token, to }: ConversationOfOptions) {
    if (to.startsWith("#")) return channelNamed({ token, name: to });

    const person = isEmail(to) ? await memberByEmail({ token, email: to }) : to;

    if (!isPerson(person)) return to;

    const { channel } = await call({
      token,
      method: "conversations.open",
      schema: openedSchema,
      params: { users: person },
    });

    return channel.id;
  }

  type UploadOptions = {
    token: string;
    conversation: string;
    thread: string | undefined;
    files: OutboundFile[];
  };

  // Each file goes up on its own, then they show together after the text, in its thread if it went
  // in one.
  async function upload({ token, conversation, thread, files }: UploadOptions) {
    const uploaded = await Promise.all(
      files.map(async ({ name, type, content }) => {
        const { upload_url: uploadUrl, file_id: id } = await call({
          token,
          method: "files.getUploadURLExternal",
          schema: uploadSchema,
          params: { filename: name, length: String(content.byteLength) },
        });

        const response = await fetch(uploadUrl, {
          method: "POST",
          body: new Blob([content], { type }),
          signal: AbortSignal.timeout(fileTimeout),
        }).catch((cause: unknown) => {
          throw new Error("Slack could not be reached", { cause });
        });

        if (!response.ok) throw new Error(`Slack returned HTTP ${response.status} for ${name}`);

        return { id, title: name };
      }),
    );

    await call({
      token,
      method: "files.completeUploadExternal",
      schema: z.object({}),
      params: { files: JSON.stringify(uploaded), channel_id: conversation, thread_ts: thread },
    });
  }

  // The text goes as Markdown, which agents write, and the files after it.
  async function send({ token, to, text, files, replyTo, thread }: OutgoingSlack) {
    const conversation = await conversationOf({ token, to });
    const threadTs = threadOf({ conversation, replyTo, thread });

    const { ts } = await call({
      token,
      method: "chat.postMessage",
      schema: postedSchema,
      params: { channel: conversation, markdown_text: text, thread_ts: threadTs },
    });

    if (files.length > 0) await upload({ token, conversation, thread: threadTs, files });

    return { id: idOf({ conversation, ts }), thread: idOf({ conversation, ts: threadTs ?? ts }) };
  }

  return { connect, start, send };
}

type IdOfOptions = { conversation: string; ts: string };

// A message's id in Artil, and a thread's by the message that starts it: the conversation, and the
// timestamp Slack tells its messages apart by. Every message is in a thread: the one it answers in,
// or else its own, which an answer to it starts.
function idOf({ conversation, ts }: IdOfOptions) {
  return `${conversation}:${ts}`;
}

type ThreadOfOptions = { conversation: string; replyTo: string | null; thread: string | null };

// The timestamp of the thread an answer goes in: the one the message it answers is in, when the
// answer goes to its conversation. A direct message that starts its own thread is answered beside
// it, as people answer one.
function threadOf({ conversation, replyTo, thread }: ThreadOfOptions) {
  const [threadConversation, threadTs] = thread?.split(":") ?? [];

  if (threadConversation !== conversation) return undefined;

  return isDirectMessage(conversation) && replyTo === thread ? undefined : threadTs;
}

// Slack escapes &, < and > in what people write, to tell them from its own markup, like <@U123>.
function unescaped(text: string) {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}
