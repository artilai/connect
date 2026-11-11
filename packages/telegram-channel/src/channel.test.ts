import { expect, test } from "bun:test";

import type { ChannelEvent, OutboundMessage } from "@artil/channels/contract";

import { TelegramChannel } from "./channel";
import type { OutgoingTelegram, TelegramEvent, TelegramProvider } from "./provider";

// Artil holds the bot at its @username, with its token.
async function tokenOf(address: string) {
  return address === "@acmesupportbot" ? "123456:ABC" : null;
}

function setup(inbound: TelegramEvent[] = []) {
  const sent: OutgoingTelegram[] = [];
  const disconnected: string[] = [];
  const tokens: (string | null)[] = [];

  const provider: TelegramProvider = {
    connect: async () => "AcmeSupportBot",
    disconnect: async (token) => {
      disconnected.push(token);
    },
    verifyEvents: async ({ tokenOf: botTokenOf }) => {
      tokens.push(await botTokenOf("AcmeSupportBot"));

      return inbound;
    },
    start: async ({ onEvents }) => {
      await onEvents(inbound);
    },
    send: async (message) => {
      sent.push(message);

      return { id: "42:8" };
    },
  };

  return { sent, disconnected, tokens, channel: new TelegramChannel(provider) };
}

type Channel = ReturnType<typeof setup>["channel"];

// Takes a webhook the way the server does, and returns what the channel handed it.
async function takeWebhook(channel: Channel) {
  const received: ChannelEvent[] = [];

  const response = await channel.handleWebhook(new Request("https://artil.test"), {
    webhookSecret: "secret",
    tokenOf,
    receive: async (events) => {
      received.push(...events);
    },
  });

  return { response, received };
}

const outbound: OutboundMessage = {
  from: "@acmesupportbot",
  to: ["42"],
  text: "On my way",
  files: [],
  replyTo: "42:7",
};

// Telegram sends through its provider, so it never hands a message back to the server.
async function deliver() {
  throw new Error("Telegram handed a message back to the server");
}

const parsing = setup().channel;

test("connects a bot at its @username, in lowercase, with its token", async () => {
  const { channel, disconnected } = setup();

  expect(await channel.connect("123456:ABC")).toBe("@acmesupportbot");

  await channel.disconnect("123456:ABC");

  expect(disconnected).toEqual(["123456:ABC"]);
});

test("turns messages to the bot into received messages from their chat, named with their @username", async () => {
  const { channel } = setup([
    {
      type: "received",
      message: {
        id: "42:7",
        bot: "AcmeSupportBot",
        chat: "42",
        group: null,
        senderId: "42",
        fromBot: null,
        username: "AdaLovelace",
        fromName: "Ada Lovelace",
        text: "Hi",
        files: [],
        quote: null,
        replyTo: null,
      },
    },
    {
      type: "received",
      message: {
        id: "99:3",
        bot: "AcmeSupportBot",
        chat: "99",
        group: null,
        senderId: "99",
        fromBot: "OpsBot",
        username: null,
        fromName: "Ops",
        text: "Done",
        files: [],
        quote: null,
        replyTo: null,
      },
    },
  ]);

  const { response, received } = await takeWebhook(channel);

  expect(response.status).toBe(204);
  expect(received).toEqual([
    {
      type: "message.received",
      message: {
        id: "42:7",
        to: ["@acmesupportbot"],
        from: {
          address: "42",
          name: "Ada Lovelace (@AdaLovelace)",
          username: "@adalovelace",
          verified: true,
        },
        text: "Hi",
        files: [],
      },
    },
    expect.objectContaining({
      message: expect.objectContaining({
        from: expect.objectContaining({ address: "@opsbot", name: "Ops" }),
      }),
    }),
  ]);
});

test("turns updates it asks Telegram for into received messages", async () => {
  const { channel } = setup([
    {
      type: "received",
      message: {
        id: "42:7",
        bot: "AcmeSupportBot",
        chat: "42",
        group: null,
        senderId: "42",
        fromBot: null,
        username: null,
        fromName: "Ada",
        text: "Hi",
        files: [],
        quote: null,
        replyTo: null,
      },
    },
  ]);

  const received: unknown[] = [];

  await channel.start({
    token: "123456:ABC",
    webhookSecret: "secret",
    signal: new AbortController().signal,
    receive: async (events) => {
      received.push(...events);
    },
  });

  expect(received).toEqual([
    expect.objectContaining({
      type: "message.received",
      message: expect.objectContaining({
        to: ["@acmesupportbot"],
        from: expect.objectContaining({ address: "42" }),
        text: "Hi",
      }),
    }),
  ]);
});

test("hands the provider the token of the bot's address to fetch files with", async () => {
  const { channel, tokens } = setup();

  await takeWebhook(channel);

  expect(tokens).toEqual(["123456:ABC"]);
});

test("quotes the message a reply answers above its text", async () => {
  const message = {
    id: "42:9",
    bot: "AcmeSupportBot",
    chat: "42",
    group: null,
    senderId: "42",
    fromBot: null,
    username: null,
    fromName: "Ada",
    text: "Right?",
    files: [],
    quote: { fromName: "Eve", text: "Your username is @AdaLovelace.\nYour ID is 42." },
    replyTo: "42:6",
  };

  const { channel } = setup([
    { type: "received", message },
    { type: "received", message: { ...message, text: "", quote: { fromName: null, text: "Hi" } } },
  ]);

  expect((await takeWebhook(channel)).received).toMatchObject([
    {
      message: {
        text: "Eve wrote:\n> Your username is @AdaLovelace.\n> Your ID is 42.\n\nRight?",
        replyTo: "42:6",
      },
    },
    { message: { text: "> Hi" } },
  ]);
});

test("sends to one chat as the bot, answering by Telegram's id for the message", async () => {
  const { channel, sent } = setup();

  await channel.send({ message: outbound, token: "123456:ABC", deliver });

  expect(sent).toEqual([
    { token: "123456:ABC", chat: "42", text: "On my way", files: [], replyTo: "42:7" },
  ]);
});

test("writes a recipient as a chat it can send to", () => {
  expect(parsing.parseRecipient(" 42 ")).toBe("42");
  expect(parsing.parseRecipient("@OpsBot")).toBe("@opsbot");
  expect(parsing.parseRecipient("not a chat!")).toBeNull();
  expect(() => parsing.parseRecipient("@adalovelace")).toThrow(
    "A bot writes to a person by their user id, which comes with their first message, not by @adalovelace",
  );
});

test("turns a message in a group into one from whoever wrote it, which an answer takes to the group", async () => {
  const { channel } = setup([
    {
      type: "received",
      message: {
        id: "-10042:7",
        bot: "AcmeSupportBot",
        chat: "-10042",
        group: { title: "Launch" },
        senderId: "42",
        fromBot: null,
        username: "AdaLovelace",
        fromName: "Ada Lovelace",
        text: "@acmesupportbot are you there?",
        files: [],
        quote: null,
        replyTo: null,
      },
    },
  ]);

  const { received } = await takeWebhook(channel);

  expect(received).toEqual([
    {
      type: "message.received",
      message: {
        id: "-10042:7",
        to: ["@acmesupportbot"],
        from: {
          address: "42",
          name: "Ada Lovelace (@AdaLovelace)",
          username: "@adalovelace",
          verified: true,
        },
        group: { address: "-10042", name: "Launch" },
        text: "@acmesupportbot are you there?",
        files: [],
      },
    },
  ]);
  expect(channel.parseSender("-10042")).toBe("-10042");
  expect(channel.parseRecipient("-10042")).toBe("-10042");
  expect(channel.recipientWritesFirst("-10042")).toBe(true);
});

test("carries one chat, 4096 characters and up to 10 files of up to 50 MB each", async () => {
  const { channel, sent } = setup();
  const photo = { name: "a.png", type: "image/png", size: 1, content: new Uint8Array(1) };

  await channel.send({ message: { ...outbound, files: [photo] }, token: "123456:ABC", deliver });

  expect(sent).toMatchObject([{ files: [photo] }]);
  expect(channel.limits).toEqual({ recipients: 1, text: 4096, files: 10, fileSize: 50_000_000 });
});
