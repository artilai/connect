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

      return "U0BOT0001";
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
  bot: "U0BOT0001",
  group: null,
  senderId: "U0ADA0001",
  senderName: "Ada Lovelace",
  text: "Hi",
  files: [],
  thread: "D0ADA0001:1700000000.000100",
};

const outbound: OutboundMessage = {
  from: "U0BOT0001",
  to: ["U0ADA0001"],
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

test("connects an app at its bot's member id with both its tokens, in either order", async () => {
  const { channel, connected } = setup();

  expect(await channel.connect(` ${token} `)).toBe("U0BOT0001");
  expect(await channel.connect("xapp-1-app\nxoxb-1-bot")).toBe("U0BOT0001");
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

test("turns a direct message to the bot into a received message from the person", async () => {
  const { channel, started } = setup([{ type: "received", message: fromAda }]);

  expect(await start(channel)).toEqual([
    {
      type: "message.received",
      message: {
        id: "D0ADA0001:1700000000.000100",
        to: ["U0BOT0001"],
        from: { address: "U0ADA0001", name: "Ada Lovelace", username: null, verified: true },
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
        group: { id: "C0LAUNCH01", name: "#launch" },
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
        to: ["U0BOT0001"],
        from: { address: "U0ADA0001", name: "Ada Lovelace", username: null, verified: true },
        group: { address: "C0LAUNCH01", name: "#launch" },
        text: "<@U0BOT0001> are you there?",
        files: [],
        thread: "C0LAUNCH01:1700000000.000100",
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
      to: "U0ADA0001",
      text: "On my way",
      files: [],
      replyTo: "D0ADA0001:1700000000.000100",
      thread: "D0ADA0001:1700000000.000100",
    },
  ]);
});

test("writes a recipient as a person's member id or a channel's id", () => {
  expect(parsing.parseRecipient(" u0ada0001 ")).toBe("U0ADA0001");
  expect(parsing.parseRecipient("W0ADA0001")).toBe("W0ADA0001");
  expect(parsing.parseRecipient("C0LAUNCH01")).toBe("C0LAUNCH01");
  expect(parsing.parseRecipient("D0ADA0001")).toBeNull();
  expect(parsing.parseRecipient("#launch")).toBeNull();
  expect(parsing.parseRecipient("@ada")).toBeNull();
});

test("lists a sender by their member id, or everyone in a channel by its id", () => {
  expect(parsing.parseSender("U0ADA0001")).toBe("U0ADA0001");
  expect(parsing.parseSender("G0PRIVATE1")).toBe("G0PRIVATE1");
  expect(parsing.parseSender("D0ADA0001")).toBeNull();
  expect(parsing.parseSender("ada")).toBeNull();
});
