import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { Channel } from "@artil/channels/contract";
import { channel as telegramChannel } from "@artil/telegram-channel";

import { createApp } from "./app";
import type { ChannelKind } from "./channels/kinds";
import { openDatabase } from "./db/connection";
import type { Event } from "./events/event";
import { createMemoryStore } from "./files/store";
import { createHosts } from "./http/hosts";
import { createServices } from "./services";
import { createPasswordCheck, hashPassword } from "./sign-in/password";
import { pkceChallenge, randomSecret } from "./tokens/token";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export const origin = "http://localhost:4747";

// The fields of a Bot API request a test looks at; a file part shows by its name.
const botRequestSchema = z.looseObject({
  chat_id: z.union([z.number(), z.string()]).optional(),
  file_id: z.string().optional(),
  text: z.string().optional(),
});

type BotRequest = z.infer<typeof botRequestSchema>;

type BotCall = { token: string; method: string; body: BotRequest };

// An update a test has Telegram hand out, as the Bot API writes one.
export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; is_bot: boolean; first_name: string; username?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    document?: { file_id: string; file_name?: string; mime_type?: string };
  };
};

type BotResult =
  | boolean
  | TelegramUpdate[]
  | { id: number; is_bot: boolean; username: string }
  | { file_path: string }
  | { message_id: number; chat: { id: number } };

// What a test posts to the API.
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

// A Telegram that knows the bots the test names, keeps what they send, and hands out updates the
// test queues.
function createFakeTelegram() {
  const bots = new Map<string, string>();
  const calls: BotCall[] = [];
  const updates: TelegramUpdate[] = [];
  const files = new Map<string, Uint8Array>();
  let sent = 0;

  async function bodyOf({ body }: RequestInit) {
    if (!(body instanceof FormData)) {
      return botRequestSchema.parse(body ? await new Response(body).json() : {});
    }

    const fields: [string, string][] = [];

    body.forEach((value, key) => {
      fields.push([key, value instanceof File ? value.name : value]);
    });

    return botRequestSchema.parse(Object.fromEntries(fields));
  }

  function answer(result: BotResult) {
    return Response.json({ ok: true, result });
  }

  async function fetch(url: string, init: RequestInit) {
    const download = /\/file\/bot[^\/]+\/(.+)$/v.exec(url);

    if (download?.[1]) return new Response(files.get(download[1]) ?? new Uint8Array());

    const [, token = "", method = ""] = /\/bot([^\/]+)\/(\w+)$/v.exec(url) ?? [];
    const body = await bodyOf(init);

    calls.push({ token, method, body });

    const username = bots.get(token);

    if (!username) {
      return Response.json({ ok: false, description: "Unauthorized" }, { status: 401 });
    }

    switch (method) {
      case "getMe":
        return answer({ id: 1, is_bot: true, username });
      case "getUpdates":
        return answer(updates.splice(0));
      case "getFile":
        return answer({ file_path: String(body.file_id) });
      case "sendMessage":
      case "sendDocument":
        sent += 1;

        return answer({ message_id: sent, chat: { id: Number(body.chat_id) || 0 } });
      default:
        return answer(true);
    }
  }

  return {
    fetch,
    calls,
    bot(token: string, username: string) {
      bots.set(token, username);
    },
    queue(update: TelegramUpdate) {
      updates.push(update);
    },
    file(fileId: string, bytes: Uint8Array) {
      files.set(fileId, bytes);
    },
    sent: () => calls.filter(({ method }) => method === "sendMessage" || method === "sendDocument"),
  };
}

type CreateTestServerOptions = {
  // The password the sign-in page asks for.
  password?: string;
  publicUrl?: string;
  files?: boolean;
  // More channels beside Telegram and the Message URL, as a config would load them.
  channels?: readonly Channel[];
};

type CallOptions = RequestInit & { token?: string };

// The whole server on an in-memory database, answering requests without a port.
export async function createTestServer({
  password,
  publicUrl,
  files = true,
  channels: moreChannels = [],
}: CreateTestServerOptions = {}) {
  const database = openDatabase({ path: ":memory:", migrationsFolder });
  const telegramApi = createFakeTelegram();
  const memory = createMemoryStore();
  const baseUrl = publicUrl ?? origin;
  const hashed = password === undefined ? null : await hashPassword(password);

  const telegram = telegramChannel.create({
    webhookUrl: publicUrl && `${publicUrl}/api/channels/telegram`,
    secret: "webhook-secret",
    fetch: telegramApi.fetch,
    log: () => {},
  });

  const channels = new Map<ChannelKind, Channel>([
    ["telegram", telegram],
    ...moreChannels.map((channel) => [channel.kind, channel] as const),
  ]);

  const services = createServices({
    db: database.db,
    secret: "file-link-secret-of-at-least-32-chars",
    baseUrl,
    store: files ? memory.store : undefined,
    channels,
    log: () => {},
  });

  const app = createApp({
    services,
    hosts: createHosts({ publicUrl }),
    password: createPasswordCheck({ hash: async () => hashed }),
    workspace: { id: crypto.randomUUID(), name: "test", ownerId: crypto.randomUUID() },
    log: () => {},
  });

  const host = new URL(baseUrl).host;

  function call(path: string, { token, headers, ...init }: CallOptions = {}) {
    const merged = new Headers(headers);

    merged.set("host", host);

    if (token) merged.set("authorization", `Bearer ${token}`);

    return app.request(path, { ...init, headers: merged });
  }

  // An agent signed in with a token of its own.
  function agent(name: string) {
    const created = services.agents.create(name);
    const token = services.tokens.issue({ agentId: created.id, name: `${name}'s client` });

    return {
      ...created,
      token,
      call: (path: string, init: CallOptions = {}) => call(path, { ...init, token }),
      json: (path: string, body: Json) =>
        call(path, {
          method: "POST",
          token,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
    };
  }

  return {
    services,
    app,
    call,
    agent,
    telegram: telegramApi,
    telegramChannel: telegram,
    memory,
    database,
  };
}

export type TestServer = Awaited<ReturnType<typeof createTestServer>>;

export type TestAgent = ReturnType<TestServer["agent"]>;

// A PKCE pair, as a client makes one for each sign-in.
export function pkce() {
  const verifier = randomSecret();

  return { verifier, challenge: pkceChallenge(verifier) };
}

type StreamedEvent = Omit<Event, "createdAt"> & { createdAt: string };

// Connects a client to the agent, as one does before it listens.
export async function connectClient(agent: TestAgent, client = "test client") {
  const response = await agent.call(`/api/agents/${agent.id}/connection`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client, machine: "test machine" }),
  });

  return z.object({ id: z.uuid() }).parse(await response.json()).id;
}

// Opens the agent's event stream at this query, and reads its events as they come.
export async function openStream(agent: TestAgent, query = "") {
  const controller = new AbortController();

  const response = await agent.call(`/api/agents/${agent.id}/events/stream${query}`, {
    signal: controller.signal,
  });

  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";

  // The next event's data, parsed; heartbeats carry none.
  async function next(): Promise<StreamedEvent> {
    while (!buffered.includes("\n\n")) {
      const chunk = await reader?.read();

      if (!chunk || chunk.done) throw new Error("The stream ended");

      buffered += chunk.value;
    }

    const end = buffered.indexOf("\n\n");
    const block = buffered.slice(0, end);

    buffered = buffered.slice(end + 2);

    const data = block
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice("data: ".length);

    // SAFETY: the server writes each event's data as an Event in JSON, with its date as a string.
    return data === undefined ? next() : (JSON.parse(data) as StreamedEvent);
  }

  return {
    response,
    next,

    close() {
      controller.abort();
    },
  };
}

// Opens the agent's event stream as a client that connected, and reads its events as they come.
export async function listen(agent: TestAgent, client = "test client") {
  const connectionId = await connectClient(agent, client);

  return { ...(await openStream(agent, `?connection=${connectionId}`)), connectionId };
}
