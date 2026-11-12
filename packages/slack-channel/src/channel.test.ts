import { expect, test } from "bun:test";

import type { ChannelEvent, OutboundMessage } from "@artil/channels/contract";

import { SlackChannel } from "./channel";
import type {
  InboundSlack,
  OutgoingSlack,
  SlackEvent,
  SlackProvider,
  SlackTokens,
} from "./provider";

// What connecting the app takes: its bot token and its app-level token, with a space between.
const token = "xoxb-1-bot xapp-1-app";

function setup(inbound: SlackEvent[] = []) {
  const sent: OutgoingSlack[] = [];
  const connected: SlackTokens[] = [];
  const started: SlackTokens[] = [];

  const provider: SlackProvider = {
    connect: async (tokens) => {
      connected.push(tokens);

      return "claude";
    },
    start: async ({ tokens, onEvents }) => {
      started.push(tokens);
      await onEvents(inbound);
    },
    send: async (message) => {
      sent.push(message);

      return { id: "D0ADA0001:1700000000.000200", thread: "D0ADA0001:1700000000.000200" };
    },
  };

  return { sent, connected, started, channel: new SlackChannel(provider) };
}

type Channel = ReturnType<typeof setup>["channel"];

// Starts the channel the way the server does, and returns what it handed the server.
async function start(channel: Channel) {
  const received: ChannelEvent[] = [];

  await channel.start({
    token,
    webhookSecret: "secret",
    signal: new AbortController().signal,
    receive: async (events) => {
      received.push(...events);
    },
  });

  return received;
}

const fromAda: InboundSlack = {
  id: "D0ADA0001:1700000000.000100",
  bot: "claude",
  group: null,
  sender: { id: "U0ADA0001", name: "Ada Lovelace", email: "Ada@Example.com", bot: null },
  text: "Hi",
  files: [],
  quotes: [],
  thread: "D0ADA0001:1700000000.000100",
};

const outbound: OutboundMessage = {
  from: "@claude",
  to: ["ada@example.com"],
  text: "On my way",
  files: [],
  replyTo: "D0ADA0001:1700000000.000100",
  thread: "D0ADA0001:1700000000.000100",
};

// Slack sends through its provider, so it never hands a message back to the server.
async function deliver() {
  throw new Error("Slack handed a message back to the server");
}

const parsing = setup().channel;

test("connects an app at its bot's @username with both its tokens, in either order", async () => {
  const { channel, connected } = setup();

  expect(await channel.connect(` ${token} `)).toBe("@claude");
  expect(await channel.connect("xapp-1-app\nxoxb-1-bot")).toBe("@claude");
  expect(connected).toEqual([
    { bot: "xoxb-1-bot", app: "xapp-1-app" },
    { bot: "xoxb-1-bot", app: "xapp-1-app" },
  ]);
});

test("refuses to connect without both tokens", async () => {
  const { channel, connected } = setup();

  const refusal =
    "A Slack app connects with its bot token, which starts with xoxb-, and its app-level token, which starts with xapp-, with a space between";

  await expect(channel.connect("xoxb-1-bot")).rejects.toThrow(refusal);
  await expect(channel.connect("xoxb-1-bot xoxb-2-bot")).rejects.toThrow(refusal);
  await expect(channel.connect(`${token} xapp-2-app`)).rejects.toThrow(refusal);
  expect(connected).toEqual([]);
});

test("turns a direct message to the bot into a received message from the person, by their email", async () => {
  const { channel, started } = setup([{ type: "received", message: fromAda }]);

  expect(await start(channel)).toEqual([
    {
      type: "message.received",
      message: {
        id: "D0ADA0001:1700000000.000100",
        to: ["@claude"],
        from: { address: "ada@example.com", name: "Ada Lovelace", username: null, verified: true },
        text: "Hi",
        files: [],
        thread: "D0ADA0001:1700000000.000100",
      },
    },
  ]);
  expect(started).toEqual([{ bot: "xoxb-1-bot", app: "xapp-1-app" }]);
});

test("turns a mention in a channel's thread into a message from whoever wrote it, which an answer takes to the channel", async () => {
  const { channel } = setup([
    {
      type: "received",
      message: {
        ...fromAda,
        id: "C0LAUNCH01:1700000000.000300",
        group: { id: "C0LAUNCH01", name: "launch" },
        text: "<@U0BOT0001> are you there?",
        thread: "C0LAUNCH01:1700000000.000100",
      },
    },
  ]);

  expect(await start(channel)).toEqual([
    {
      type: "message.received",
      message: {
        id: "C0LAUNCH01:1700000000.000300",
        to: ["@claude"],
        from: { address: "ada@example.com", name: "Ada Lovelace", username: null, verified: true },
        group: { address: "#launch", name: "#launch" },
        text: "<@U0BOT0001> are you there?",
        files: [],
        thread: "C0LAUNCH01:1700000000.000100",
      },
    },
  ]);
});

test("names a bot by its @username, and by their ids a person and a channel Slack tells no more of", async () => {
  const { channel } = setup([
    {
      type: "received",
      message: {
        ...fromAda,
        sender: { id: "U0OPS0001", name: "Ops", email: null, bot: "opsbot" },
      },
    },
    {
      type: "received",
      message: {
        ...fromAda,
        group: { id: "G0FRIENDS1", name: null },
        sender: { id: "U0ADA0001", name: null, email: null, bot: null },
      },
    },
  ]);

  expect(await start(channel)).toMatchObject([
    { message: { from: { address: "@opsbot" } } },
    {
      message: {
        from: { address: "U0ADA0001" },
        group: { address: "G0FRIENDS1", name: null },
      },
    },
  ]);
});

test("quotes what was said in a thread before a mention above its text", async () => {
  const { channel } = setup([
    {
      type: "received",
      message: {
        ...fromAda,
        text: "<@U0BOT0001> can you look?",
        quotes: [
          { fromName: "Eve", text: "Deploy failed\non migration 0005" },
          { fromName: null, text: "Build 42 failed" },
        ],
      },
    },
  ]);

  expect(await start(channel)).toMatchObject([
    {
      message: {
        text: "Eve wrote:\n> Deploy failed\n> on migration 0005\n\n> Build 42 failed\n\n<@U0BOT0001> can you look?",
      },
    },
  ]);
});

test("sends to one person or channel with the bot token, in the thread of what it answers", async () => {
  const { channel, sent } = setup();

  expect(await channel.send({ message: outbound, token, deliver })).toEqual({
    id: "D0ADA0001:1700000000.000200",
    thread: "D0ADA0001:1700000000.000200",
  });
  expect(sent).toEqual([
    {
      token: "xoxb-1-bot",
      to: "ada@example.com",
      text: "On my way",
      files: [],
      replyTo: "D0ADA0001:1700000000.000100",
      thread: "D0ADA0001:1700000000.000100",
    },
  ]);
});

test("writes to a person by their email and a channel by its #name, or either by its id", () => {
  expect(parsing.parseRecipient(" Ada@Example.com ")).toBe("ada@example.com");
  expect(parsing.parseRecipient("#Launch")).toBe("#launch");
  expect(parsing.parseRecipient(" u0ada0001 ")).toBe("U0ADA0001");
  expect(parsing.parseRecipient("C0LAUNCH01")).toBe("C0LAUNCH01");
  expect(parsing.parseRecipient("D0ADA0001")).toBeNull();
  expect(parsing.parseRecipient("@ada")).toBeNull();
  expect(parsing.parseRecipient("# launch")).toBeNull();
});

test("lists a sender by their email, or everyone in a channel by its #name", () => {
  expect(parsing.parseSender("ada@example.com")).toBe("ada@example.com");
  expect(parsing.parseSender("#launch")).toBe("#launch");
  expect(parsing.parseSender("ada")).toBeNull();
});

test("asks for each token after the steps that get it, from a link that makes the account's app", () => {
  const [bot, app] = parsing.tokenParts("Claude Code");
  const link = /https:\/\/api\.slack\.com\/\S+/v.exec(bot?.guide ?? "")?.[0] ?? "";
  const manifest = new URL(link).searchParams.get("manifest_json") ?? "";

  expect(JSON.parse(manifest)).toMatchObject({
    display_information: { name: "Claude Code" },
    features: { bot_user: { display_name: "claude-code" } },
    settings: { event_subscriptions: { bot_events: ["app_mention", "message.im"] } },
  });
  expect(bot?.label).toBe("bot token (xoxb-…)");
  expect(app).toEqual({
    label: "app-level token (xapp-…)",
    guide:
      "3. Under Basic Information, generate an App-Level Token with the connections:write scope.",
  });
});
