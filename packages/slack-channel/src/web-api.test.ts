import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import type { ServerWebSocket } from "bun";

import type { SlackEvent } from "./provider";
import { createWebApi } from "./web-api";

const tokens = { bot: "xoxb-1-bot", app: "xapp-1-app" };

// What Slack answers: a call with a JSON body, and a request for a file with its content; a list
// answers one request each, its last the rest. A call is answered by its method, or by its method
// and arguments, like "users.info?user=U0EVE0001".
type Answer = {
  status?: number;
  body?: unknown;
  type?: string;
  content?: string | Uint8Array<ArrayBuffer>;
};

type Answers = Record<string, Answer | Answer[]>;

const fileBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

type SetupOptions = { answers?: Answers; heartbeat?: number };

function setup({ answers = {}, heartbeat }: SetupOptions = {}) {
  const requests: { method: string; token: string | null; body: unknown }[] = [];

  function next(method: string) {
    const answer = answers[method];

    if (!Array.isArray(answer)) return answer;

    return answer.length > 1 ? answer.shift() : answer[0];
  }

  const slack = createWebApi({
    heartbeat,
    fetch: async (url, init) => {
      const token = new Headers(init.headers).get("authorization")?.replace("Bearer ", "") ?? null;
      const { hostname, pathname } = new URL(url);

      // Files come and go at files.slack.com, everything else at the Web API.
      if (hostname === "files.slack.com") {
        const method = pathname.startsWith("/upload/") ? "upload" : "download";
        const body = method === "upload" ? await new Response(init.body).text() : pathname;

        requests.push({ method, token, body });

        const answer = next(method) ?? { content: fileBytes };

        return new Response(answer.content, {
          status: answer.status ?? 200,
          headers: { "content-type": answer.type ?? "application/pdf" },
        });
      }

      const method = pathname.replace("/api/", "");
      const form = new URLSearchParams(await new Response(init.body).text());

      requests.push({ method, token, body: Object.fromEntries(form) });

      const answer = next(`${method}?${form.toString()}`) ?? next(method) ?? { body: { ok: true } };

      return Response.json(answer.body, { status: answer.status ?? 200 });
    },
  });

  return { slack, requests };
}

const botAnswer = {
  body: { ok: true, user_id: "U0BOT0001", user: "claude", bot_id: "B0BOT0001" },
};

const adaAnswer = {
  body: {
    ok: true,
    user: {
      id: "U0ADA0001",
      name: "ada",
      real_name: "Ada Lovelace",
      profile: { email: "ada@example.com" },
    },
  },
};

const ada = { id: "U0ADA0001", name: "Ada Lovelace", email: "ada@example.com", bot: null };

const launchAnswer = { body: { ok: true, channel: { id: "C0LAUNCH01", name: "launch" } } };

const botInfoAnswer = { body: { ok: true, bot: { id: "B0BOT0001", app_id: "A0APP0001" } } };

test("checks the app's tokens and finds its bot's member id", async () => {
  const socket = socketMode();

  const { slack, requests } = setup({
    answers: {
      "auth.test": botAnswer,
      "apps.connections.open": { body: { ok: true, url: socket.url } },
      "bots.info": botInfoAnswer,
    },
  });

  expect(await slack.connect(tokens)).toBe("claude");
  socket.stop();
  expect(requests).toEqual([
    { method: "auth.test", token: "xoxb-1-bot", body: {} },
    { method: "apps.connections.open", token: "xapp-1-app", body: {} },
    { method: "bots.info", token: "xoxb-1-bot", body: { bot: "B0BOT0001" } },
  ]);
});

test("refuses tokens of two different apps", async () => {
  const socket = socketMode({ app: "A0OTHER01" });

  const { slack } = setup({
    answers: {
      "auth.test": botAnswer,
      "apps.connections.open": { body: { ok: true, url: socket.url } },
      "bots.info": botInfoAnswer,
    },
  });

  await expect(slack.connect(tokens)).rejects.toMatchObject({
    code: "invalid_input",
    message:
      "The bot token and the app-level token belong to different Slack apps; give both of one app",
  });
  socket.stop();
});

test("refuses a token Slack does not know", async () => {
  const refused = { body: { ok: false, error: "invalid_auth" } };

  await expect(
    setup({ answers: { "auth.test": refused } }).slack.connect(tokens),
  ).rejects.toMatchObject({
    code: "invalid_input",
    message: "Slack refused the bot token: invalid_auth",
  });

  await expect(
    setup({ answers: { "auth.test": botAnswer, "apps.connections.open": refused } }).slack.connect(
      tokens,
    ),
  ).rejects.toMatchObject({
    code: "invalid_input",
    message: "Slack refused the app-level token: invalid_auth",
  });
});

async function until(done: () => boolean) {
  while (!done()) await Bun.sleep(1);
}

type SocketModeOptions = { app?: string };

// Slack's side of Socket Mode: greets each connection the server opens, naming the app it is for,
// and keeps the ids of the envelopes the server acknowledged.
function socketMode({ app = "A0APP0001" }: SocketModeOptions = {}) {
  const connections: ServerWebSocket[] = [];
  const acks: string[] = [];

  const server = Bun.serve({
    port: 0,
    fetch: (request, upgrading) =>
      upgrading.upgrade(request) ? undefined : new Response(null, { status: 400 }),
    websocket: {
      open: (socket) => {
        connections.push(socket);
        socket.send(JSON.stringify({ type: "hello", connection_info: { app_id: app } }));
      },
      message: (_socket, data) => {
        acks.push(JSON.parse(String(data)).envelope_id);
      },
    },
  });

  // The connection the server opened as the index says, once it opens it.
  async function connection(index: number) {
    await until(() => connections.length > index);

    const socket = connections[index];

    if (!socket) throw new Error(`No connection ${index}`);

    return socket;
  }

  return {
    url: `ws://localhost:${server.port}`,
    acks,
    connection,
    // Bun never settles stopping a server that closed a connection itself, so nothing waits for it.
    stop: () => {
      void server.stop(true);
    },
  };
}

type File = {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  url_private_download?: string;
};

// An event as Slack sends it in an envelope.
type Event = {
  type: string;
  subtype?: string;
  channel: string;
  channel_type?: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  files?: File[];
};

type EnvelopeOptions = { id: string; event: Event };

function envelope({ id, event }: EnvelopeOptions) {
  return JSON.stringify({
    type: "events_api",
    envelope_id: id,
    payload: { type: "event_callback", event_id: `Ev-${id}`, event },
    accepts_response_payload: false,
    retry_attempt: 0,
  });
}

type ReceiveOptions = { events: Event[]; answers?: Answers };

// Sends each event over Socket Mode in an envelope of its own, the way Slack does, and stops once
// the server acknowledged them all.
async function receive({ events, answers = {} }: ReceiveOptions) {
  const socket = socketMode();

  const { slack, requests } = setup({
    answers: {
      "auth.test": botAnswer,
      "apps.connections.open": { body: { ok: true, url: socket.url } },
      "users.info": adaAnswer,
      "conversations.info": launchAnswer,
      ...answers,
    },
  });

  const controller = new AbortController();
  const taken: SlackEvent[] = [];

  const started = slack.start({
    tokens,
    signal: controller.signal,
    onEvents: async (batch) => {
      taken.push(...batch);
    },
  });

  try {
    const connection = await socket.connection(0);

    for (const [index, event] of events.entries()) {
      connection.send(envelope({ id: `envelope-${index}`, event }));
    }

    await until(() => socket.acks.length === events.length);
    controller.abort();
    await started;
  } finally {
    socket.stop();
  }

  return { taken, requests, acks: socket.acks };
}

const fromAda: Event = {
  type: "message",
  channel: "D0ADA0001",
  channel_type: "im",
  user: "U0ADA0001",
  text: "Is 1 &lt; 2 &amp;&amp; 3 &gt; 2?",
  ts: "1700000000.000100",
};

const inLaunch: Event = {
  type: "app_mention",
  channel: "C0LAUNCH01",
  user: "U0ADA0001",
  text: "<@U0BOT0001> are you there?",
  ts: "1700000000.000300",
};

test("takes direct messages to the bot over Socket Mode, each in a thread of its own", async () => {
  const { taken, requests, acks } = await receive({
    events: [
      fromAda,
      { ...fromAda, user: "U0BOT0001", text: "The bot's own", ts: "1700000000.000200" },
      { ...fromAda, subtype: "message_changed", ts: "1700000000.000400" },
    ],
  });

  expect(taken).toEqual([
    {
      type: "received",
      message: {
        id: "D0ADA0001:1700000000.000100",
        bot: "claude",
        group: null,
        sender: ada,
        text: "Is 1 < 2 && 3 > 2?",
        files: [],
        quotes: [],
        thread: "D0ADA0001:1700000000.000100",
      },
    },
  ]);
  expect(acks).toEqual(["envelope-0", "envelope-1", "envelope-2"]);
  expect(requests.slice(0, 3)).toEqual([
    { method: "auth.test", token: "xoxb-1-bot", body: {} },
    { method: "apps.connections.open", token: "xapp-1-app", body: {} },
    { method: "users.info", token: "xoxb-1-bot", body: { user: "U0ADA0001" } },
  ]);
});

test("takes what mentions the bot in a channel, by the channel's name and the thread it is in", async () => {
  const { taken, requests } = await receive({
    events: [
      { ...inLaunch, thread_ts: "1700000000.000100" },
      // A mention in a direct message comes as a message too, which the bot takes.
      { ...inLaunch, channel: "D0ADA0001" },
      { ...inLaunch, type: "message", channel_type: "channel", text: "Hi all" },
    ],
  });

  expect(taken).toEqual([
    {
      type: "received",
      message: {
        id: "C0LAUNCH01:1700000000.000300",
        bot: "claude",
        group: { id: "C0LAUNCH01", name: "launch" },
        sender: ada,
        text: "<@U0BOT0001> are you there?",
        files: [],
        quotes: [],
        thread: "C0LAUNCH01:1700000000.000100",
      },
    },
  ]);
  expect(requests).toContainEqual({
    method: "conversations.info",
    token: "xoxb-1-bot",
    body: { channel: "C0LAUNCH01" },
  });
});

test("quotes what was said in a channel's thread since the bot last wrote there", async () => {
  const { taken, requests } = await receive({
    events: [{ ...inLaunch, thread_ts: "1700000000.000100" }],
    answers: {
      "users.info?user=U0EVE0001": { body: { ok: true, user: { name: "eve", real_name: "Eve" } } },
      // The thread comes in two pages.
      "conversations.replies": [
        {
          body: {
            ok: true,
            messages: [
              { user: "U0BOB0001", text: "Deploy failed on migration 0005" },
              { user: "U0BOT0001", text: "Looking" },
            ],
            response_metadata: { next_cursor: "page-2" },
          },
        },
        {
          body: {
            ok: true,
            messages: [
              { user: "U0EVE0001", text: "The column is there &amp; empty" },
              // A file alone says nothing to quote.
              { user: "U0EVE0001", text: "" },
              { bot_profile: { name: "CI" }, text: "Build 42 failed" },
            ],
          },
        },
      ],
    },
  });

  expect(taken).toMatchObject([
    {
      message: {
        quotes: [
          { fromName: "Eve", text: "The column is there & empty" },
          { fromName: "CI", text: "Build 42 failed" },
        ],
      },
    },
  ]);
  const thread = { channel: "C0LAUNCH01", ts: "1700000000.000100", latest: "1700000000.000300" };

  expect(requests.filter(({ method }) => method === "conversations.replies")).toEqual([
    { method: "conversations.replies", token: "xoxb-1-bot", body: { ...thread, limit: "999" } },
    {
      method: "conversations.replies",
      token: "xoxb-1-bot",
      body: { ...thread, limit: "999", cursor: "page-2" },
    },
  ]);
});

test("goes without the names and the thread Slack does not give", async () => {
  const refused = { body: { ok: false, error: "missing_scope" } };

  const { taken } = await receive({
    events: [{ ...inLaunch, channel: "G0FRIENDS1", thread_ts: "1700000000.000100" }],
    answers: {
      "users.info": refused,
      "conversations.info": refused,
      "conversations.replies": refused,
    },
  });

  expect(taken).toMatchObject([
    {
      message: {
        sender: { name: null, email: null },
        group: { id: "G0FRIENDS1", name: null },
        quotes: [],
      },
    },
  ]);
});

function fileOf(name: string, size: number): File {
  return {
    id: `F0${name}`,
    name,
    mimetype: "application/pdf",
    size,
    url_private_download: `https://files.slack.com/files-pri/T0-F0/download/${name}`,
  };
}

test("downloads a message's files with the bot token, and describes the ones it cannot", async () => {
  const { taken, requests } = await receive({
    events: [
      {
        ...fromAda,
        subtype: "file_share",
        text: "The notes",
        files: [
          fileOf("notes.pdf", 4),
          fileOf("video.pdf", 90_000_000),
          fileOf("private.pdf", 4),
          { id: "F0hidden", name: "old.pdf", mimetype: "application/pdf", size: 4 },
        ],
      },
    ],
    answers: {
      download: [
        { content: fileBytes },
        // Slack's sign-in page, which it shows a bot without the files:read scope.
        { type: "text/html", content: "<html>Sign in</html>" },
      ],
    },
  });

  expect(taken).toMatchObject([
    {
      message: {
        text: "The notes",
        files: [
          { name: "notes.pdf", type: "application/pdf", size: 4, content: fileBytes },
          { name: "video.pdf", type: "application/pdf", size: 90_000_000, content: null },
          { name: "private.pdf", type: "application/pdf", size: 4, content: null },
          { name: "old.pdf", type: "application/pdf", size: 4, content: null },
        ],
      },
    },
  ]);
  expect(requests.filter(({ method }) => method === "download")).toEqual([
    { method: "download", token: "xoxb-1-bot", body: "/files-pri/T0-F0/download/notes.pdf" },
    { method: "download", token: "xoxb-1-bot", body: "/files-pri/T0-F0/download/private.pdf" },
  ]);
});

test("acknowledges an envelope as it comes, and takes its event before connecting again when Slack asks", async () => {
  const socket = socketMode();

  const { slack } = setup({
    answers: {
      "auth.test": botAnswer,
      "apps.connections.open": { body: { ok: true, url: socket.url } },
      "users.info": adaAnswer,
    },
  });

  const controller = new AbortController();
  const taken: SlackEvent[] = [];

  const started = slack.start({
    tokens,
    signal: controller.signal,
    // Takes the event only after Slack has it acknowledged, as after a slow download.
    onEvents: async (batch) => {
      await until(() => socket.acks.length === 1);
      taken.push(...batch);
    },
  });

  const connection = await socket.connection(0);

  connection.send(envelope({ id: "envelope-0", event: fromAda }));
  connection.send(JSON.stringify({ type: "disconnect", reason: "refresh_requested" }));
  await socket.connection(1);

  expect(taken).toHaveLength(1);

  controller.abort();
  await started;
  socket.stop();
});

type StartFailingOptions = { url: string; heartbeat?: number; onEvents?: () => Promise<void> };

// Starts the bot on a Socket Mode connection where something goes wrong, and returns how it ended.
function startFailing({ url, heartbeat, onEvents = async () => {} }: StartFailingOptions) {
  const { slack } = setup({
    heartbeat,
    answers: { "auth.test": botAnswer, "apps.connections.open": { body: { ok: true, url } } },
  });

  return slack.start({ tokens, signal: new AbortController().signal, onEvents });
}

test("fails when the server cannot take an event Slack has as delivered", async () => {
  const socket = socketMode();

  const started = startFailing({
    url: socket.url,
    onEvents: async () => {
      throw new Error("Could not store the message");
    },
  });

  (await socket.connection(0)).send(envelope({ id: "envelope-0", event: fromAda }));

  await expect(started).rejects.toThrow("Could not store the message");
  await until(() => socket.acks.length === 1);
  socket.stop();

  expect(socket.acks).toEqual(["envelope-0"]);
});

test("fails when Slack closes the connection, for the server to start again", async () => {
  const socket = socketMode();
  const started = startFailing({ url: socket.url });

  (await socket.connection(0)).close();

  await expect(started).rejects.toThrow("Slack closed the connection");
  socket.stop();
});

// The fixed key a WebSocket server answers a handshake with.
const handshakeGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

test("fails a connection that stops answering, as after the computer slept", async () => {
  // A server that takes the connection and then answers nothing, not even a ping.
  const silent = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data: (socket, data) => {
        const key = /sec-websocket-key: (.+)\r\n/iv.exec(data.toString())?.[1];

        if (!key) return;

        const accept = createHash("sha1").update(`${key}${handshakeGuid}`).digest("base64");

        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
      },
    },
  });

  const started = startFailing({ url: `ws://127.0.0.1:${silent.port}`, heartbeat: 20 });

  await expect(started).rejects.toThrow("Slack stopped answering");
  silent.stop(true);
});

const postedAnswer = { body: { ok: true, channel: "C0LAUNCH01", ts: "1700000000.000500" } };

const hello = { token: "xoxb-1-bot", text: "**Done**", files: [], replyTo: null, thread: null };

test("writes to a person by their email, in their direct message, in Markdown", async () => {
  const { slack, requests } = setup({
    answers: {
      "users.lookupByEmail": { body: { ok: true, user: { id: "U0ADA0001" } } },
      "conversations.open": { body: { ok: true, channel: { id: "D0ADA0001" } } },
      "chat.postMessage": postedAnswer,
    },
  });

  expect(await slack.send({ ...hello, to: "ada@example.com" })).toEqual({
    id: "D0ADA0001:1700000000.000500",
    thread: "D0ADA0001:1700000000.000500",
  });
  expect(requests).toEqual([
    { method: "users.lookupByEmail", token: "xoxb-1-bot", body: { email: "ada@example.com" } },
    { method: "conversations.open", token: "xoxb-1-bot", body: { users: "U0ADA0001" } },
    {
      method: "chat.postMessage",
      token: "xoxb-1-bot",
      body: { channel: "D0ADA0001", markdown_text: "**Done**" },
    },
  ]);
});

test("writes to a channel by its #name, among the channels the bot is in", async () => {
  const { slack, requests } = setup({
    answers: {
      "users.conversations": {
        body: { ok: true, channels: [{ id: "C0LAUNCH01", name: "launch" }] },
      },
      "chat.postMessage": postedAnswer,
    },
  });

  await slack.send({ ...hello, to: "#launch" });

  await expect(slack.send({ ...hello, to: "#nowhere" })).rejects.toThrow(
    "The bot is not in #nowhere; invite it there with /invite",
  );
  expect(requests.find(({ method }) => method === "chat.postMessage")?.body).toEqual({
    channel: "C0LAUNCH01",
    markdown_text: "**Done**",
  });
});

test("answers in the thread of the message it answers, and beside one in a direct message", async () => {
  const { slack, requests } = setup({ answers: { "chat.postMessage": postedAnswer } });
  const answer = { token: "xoxb-1-bot", text: "On it", files: [] };

  // Answers to a message that starts its thread, and to one in the thread of another.
  const inChannel = {
    replyTo: "C0LAUNCH01:1700000000.000300",
    thread: "C0LAUNCH01:1700000000.000300",
  };

  const inChannelThread = { ...inChannel, thread: "C0LAUNCH01:1700000000.000100" };
  const direct = { replyTo: "D0ADA0001:1700000000.000300", thread: "D0ADA0001:1700000000.000300" };
  const directThread = { ...direct, thread: "D0ADA0001:1700000000.000100" };

  expect(await slack.send({ ...answer, ...inChannel, to: "C0LAUNCH01" })).toEqual({
    id: "C0LAUNCH01:1700000000.000500",
    thread: "C0LAUNCH01:1700000000.000300",
  });
  await slack.send({ ...answer, ...inChannelThread, to: "C0LAUNCH01" });
  await slack.send({ ...answer, ...direct, to: "D0ADA0001" });
  await slack.send({ ...answer, ...directThread, to: "D0ADA0001" });
  await slack.send({ ...answer, ...inChannel, to: "C0OTHER001" });

  expect(requests.map(({ body }) => body)).toEqual([
    { channel: "C0LAUNCH01", markdown_text: "On it", thread_ts: "1700000000.000300" },
    { channel: "C0LAUNCH01", markdown_text: "On it", thread_ts: "1700000000.000100" },
    { channel: "D0ADA0001", markdown_text: "On it" },
    { channel: "D0ADA0001", markdown_text: "On it", thread_ts: "1700000000.000100" },
    { channel: "C0OTHER001", markdown_text: "On it" },
  ]);
});

function outgoingFile(name: string, text: string) {
  return {
    name,
    type: "application/pdf",
    size: text.length,
    content: new TextEncoder().encode(text),
  };
}

test("sends files after the text, in its thread", async () => {
  const { slack, requests } = setup({
    answers: {
      "chat.postMessage": postedAnswer,
      "files.getUploadURLExternal": [
        { body: { ok: true, upload_url: "https://files.slack.com/upload/v1/a", file_id: "F0A" } },
        { body: { ok: true, upload_url: "https://files.slack.com/upload/v1/b", file_id: "F0B" } },
      ],
      upload: { content: "OK - 1" },
    },
  });

  await slack.send({
    token: "xoxb-1-bot",
    to: "C0LAUNCH01",
    text: "The notes",
    files: [outgoingFile("a.pdf", "A"), outgoingFile("b.pdf", "B")],
    replyTo: "C0LAUNCH01:1700000000.000300",
    thread: "C0LAUNCH01:1700000000.000300",
  });

  expect(requests[0]?.method).toBe("chat.postMessage");
  expect(requests.at(-1)?.method).toBe("files.completeUploadExternal");
  expect(requests).toEqual(
    expect.arrayContaining([
      {
        method: "files.getUploadURLExternal",
        token: "xoxb-1-bot",
        body: { filename: "a.pdf", length: "1" },
      },
      { method: "upload", token: null, body: "A" },
      { method: "upload", token: null, body: "B" },
      {
        method: "files.completeUploadExternal",
        token: "xoxb-1-bot",
        body: {
          files: JSON.stringify([
            { id: "F0A", title: "a.pdf" },
            { id: "F0B", title: "b.pdf" },
          ]),
          channel_id: "C0LAUNCH01",
          thread_ts: "1700000000.000300",
        },
      },
    ]),
  );
});

test("fails a send with Slack's reason, naming a scope the app lacks", async () => {
  const toLaunch = { ...hello, to: "C0LAUNCH01" };

  await expect(
    setup({
      answers: { "chat.postMessage": { body: { ok: false, error: "not_in_channel" } } },
    }).slack.send(toLaunch),
  ).rejects.toThrow("not_in_channel");

  await expect(
    setup({
      answers: {
        "chat.postMessage": {
          body: { ok: false, error: "missing_scope", needed: "chat:write" },
        },
      },
    }).slack.send(toLaunch),
  ).rejects.toThrow("missing_scope: the Slack app needs the chat:write scope");
});
