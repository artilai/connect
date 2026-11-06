import { expect, test } from "bun:test";

import type { ChannelEvent, OutboundMessage } from "@artil/channels/contract";

import { createTelegramChannel } from "./channel";
import type { OutgoingTelegram, TelegramEvent, TelegramProvider } from "./provider";

// Artil holds the bot at its @username, with its token.
async function credentialsOf(address: string) {
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
    verifyEvents: async (_request, tokenOf) => {
      tokens.push(await tokenOf("AcmeSupportBot"));

      return inbound;
    },
    start: async ({ onEvents }) => {
      await onEvents(inbound);
    },
    send: async (message) => {
      sent.push(message);

      return { externalId: "42:8" };
    },
  };

  return { sent, disconnected, tokens, channel: createTelegramChannel(provider) };
}

type Channel = ReturnType<typeof setup>["channel"];

// Takes a webhook the way the server does, and returns what the channel handed it.
async function takeWebhook(channel: Channel) {
  const received: ChannelEvent[] = [];

  const response = await channel.handleWebhook(new Request("https://artil.test"), {
    credentialsOf,
    receive: async (events) => {
      received.push(...events);
    },
  });

  return { response, received };
}

const outbound: OutboundMessage = {
  from: "@acmesupportbot",
  fromName: "Support",
  credentials: "123456:ABC",
  to: [" 42 "],
  cc: [],
  subject: "Re: Hello",
  text: "On my way",
  files: [],
  inReplyTo: { messageId: "<email@example.com>", references: [] },
};

const prepare = setup().channel.prepare;

test("connects a bot at its @username, in lowercase, with its token", async () => {
  const { channel, disconnected } = setup();

  const connected = await channel.connect("123456:ABC");

  expect(connected).toEqual({ value: "@acmesupportbot", credentials: "123456:ABC" });

  await channel.disconnect(connected);

  expect(disconnected).toEqual(["123456:ABC"]);
});

test("turns messages to the bot into received messages from their chat, named with their @username", async () => {
  const { channel } = setup([
    {
      type: "received",
      message: {
        externalId: "42:7",
        bot: "AcmeSupportBot",
        chat: "42",
        fromBot: null,
        username: "AdaLovelace",
        fromName: "Ada Lovelace",
        text: "Hi",
        files: [],
        quote: null,
      },
    },
    {
      type: "received",
      message: {
        externalId: "99:3",
        bot: "AcmeSupportBot",
        chat: "99",
        fromBot: "OpsBot",
        username: null,
        fromName: "Ops",
        text: "Done",
        files: [],
        quote: null,
      },
    },
  ]);

  const { response, received } = await takeWebhook(channel);

  expect(response.status).toBe(204);
  expect(received).toEqual([
    {
      type: "message.received",
      message: {
        externalId: "42:7",
        to: "@acmesupportbot",
        addressees: { to: ["@acmesupportbot"], cc: [] },
        from: "42",
        fromName: "Ada Lovelace (@AdaLovelace)",
        fromHandle: "@adalovelace",
        fromVerified: true,
        subject: null,
        text: "Hi",
        files: [],
        spam: false,
        thread: null,
      },
    },
    expect.objectContaining({
      message: expect.objectContaining({ from: "@opsbot", fromName: "Ops" }),
    }),
  ]);
});

test("turns updates it asks Telegram for into received messages", async () => {
  const { channel } = setup([
    {
      type: "received",
      message: {
        externalId: "42:7",
        bot: "AcmeSupportBot",
        chat: "42",
        fromBot: null,
        username: null,
        fromName: "Ada",
        text: "Hi",
        files: [],
        quote: null,
      },
    },
  ]);

  const received: unknown[] = [];

  await channel.start({
    credentials: "123456:ABC",
    signal: new AbortController().signal,
    receive: async (events) => {
      received.push(...events);
    },
    onError: () => {},
  });

  expect(received).toEqual([
    expect.objectContaining({
      type: "message.received",
      message: expect.objectContaining({ to: "@acmesupportbot", from: "42", text: "Hi" }),
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
    externalId: "42:9",
    bot: "AcmeSupportBot",
    chat: "42",
    fromBot: null,
    username: null,
    fromName: "Ada",
    text: "Right?",
    files: [],
    quote: { fromName: "Eve", text: "Your username is @AdaLovelace.\nYour ID is 42." },
  };

  const { channel } = setup([
    { type: "received", message },
    { type: "received", message: { ...message, text: "", quote: { fromName: null, text: "Hi" } } },
  ]);

  expect((await takeWebhook(channel)).received).toMatchObject([
    {
      message: {
        text: "Eve wrote:\n> Your username is @AdaLovelace.\n> Your ID is 42.\n\nRight?",
      },
    },
    { message: { text: "> Hi" } },
  ]);
});

test("sends to one chat as the bot, without email headers", async () => {
  const { channel, sent } = setup();
  const message = prepare(outbound);

  expect(message).toEqual({ ...outbound, to: ["42"], subject: null, inReplyTo: null });

  await channel.send(message);

  expect(sent).toEqual([{ token: "123456:ABC", chat: "42", text: "On my way", files: [] }]);
  expect(prepare({ ...outbound, to: ["@OpsBot"] }).to).toEqual(["@opsbot"]);
});

test("refuses a message Telegram cannot carry", () => {
  expect(() => prepare({ ...outbound, to: ["42", "43"] })).toThrow(
    "A Telegram message goes to one chat",
  );
  expect(() => prepare({ ...outbound, to: ["@ada"] })).toThrow(
    "@ada is not a Telegram user id or bot username",
  );
  expect(() => prepare({ ...outbound, text: "a".repeat(4097) })).toThrow(
    "A Telegram message holds at most 4096 characters",
  );
});

test("sends up to 10 files of up to 50 MB each", async () => {
  const { channel, sent } = setup();
  const photo = { name: "a.png", type: "image/png", size: 1, content: new Uint8Array(1), url: "" };

  await channel.send(prepare({ ...outbound, files: [photo] }));

  expect(sent).toMatchObject([{ files: [photo] }]);
  expect(() => prepare({ ...outbound, files: Array.from({ length: 11 }, () => photo) })).toThrow(
    "A Telegram message carries up to 10 files",
  );
  expect(() => prepare({ ...outbound, files: [{ ...photo, size: 60_000_000 }] })).toThrow(
    "a.png is 60 MB; Telegram takes files of up to 50 MB",
  );
});
