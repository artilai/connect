import type { Channel, ChannelEvent, OutboundMessage } from "@artil/channels/contract";
import { AppError } from "@artil/errors";
import { formatBytes } from "@artil/utils/text";

import { atUsername, readChat } from "./chats";
import type { InboundTelegram, TelegramProvider, TelegramQuote } from "./provider";

const maxLength = 4096;

// A bot sends up to 10 files in one album, each of up to 50 MB.
const maxFiles = 10;

const maxFileSize = 50_000_000;

export function createTelegramChannel(provider: TelegramProvider) {
  return {
    kind: "telegram",
    name: "Telegram",
    recipients: "the id of someone who wrote to the agent's bot first, or a bot's @username",

    connect: async (token) => ({
      value: atUsername(await provider.connect(token)),
      credentials: token,
    }),

    disconnect: ({ credentials }) => provider.disconnect(credentials),

    // A bot cannot start a chat with a person, but it can write first to another bot that takes
    // messages from bots.
    recipientWritesFirst: (chat) => !chat.startsWith("@"),

    start: ({ credentials, signal, receive, onError }) =>
      provider.start({
        token: credentials,
        signal,
        onEvents: (events) => receive(events.map(({ message }) => received(message))),
        onError,
      }),

    handleWebhook: async (request, { credentialsOf, receive }) => {
      const events = await provider.verifyEvents(request, (bot) => credentialsOf(atUsername(bot)));

      await receive(events.map(({ message }) => received(message)));

      return new Response(null, { status: 204 });
    },

    prepare: prepareTelegram,

    send: ({ credentials, to, text, files }) => {
      if (!credentials) throw new Error("A Telegram bot sends with its token");

      return provider.send({ token: credentials, chat: onlyChat(to), text, files });
    },
  } satisfies Channel<"telegram">;
}

function onlyChat(to: string[]) {
  const [chat, ...others] = to;

  if (chat === undefined || others.length > 0) {
    throw new AppError({ code: "invalid_input", message: "A Telegram message goes to one chat" });
  }

  return chat;
}

export function prepareTelegram(message: OutboundMessage) {
  const recipient = onlyChat(message.to);
  const chat = readChat(recipient);

  if (!chat) {
    throw new AppError({
      code: "invalid_input",
      message: `${recipient} is not a Telegram user id or bot username`,
    });
  }

  if (message.text.length > maxLength) {
    throw new AppError({
      code: "invalid_input",
      message: `A Telegram message holds at most ${maxLength} characters`,
    });
  }

  if (message.files.length > maxFiles) {
    throw new AppError({
      code: "invalid_input",
      message: `A Telegram message carries up to ${maxFiles} files`,
    });
  }

  const tooBig = message.files.find(({ size }) => size > maxFileSize);

  if (tooBig) {
    throw new AppError({
      code: "invalid_input",
      message: `${tooBig.name} is ${formatBytes(tooBig.size)}; Telegram takes files of up to ${formatBytes(maxFileSize)}`,
    });
  }

  return { ...message, to: [chat], subject: null, inReplyTo: null };
}

function received({
  externalId,
  bot,
  chat,
  fromBot,
  username,
  fromName,
  text,
  files,
  quote,
}: InboundTelegram) {
  return {
    type: "message.received",
    message: {
      externalId,
      to: atUsername(bot),
      addressees: { to: [atUsername(bot)], cc: [] },
      from: fromBot ? atUsername(fromBot) : chat,
      // A person shows by their name and @username, the way Telegram shows them.
      fromName: fromName && username ? `${fromName} (@${username})` : fromName,
      fromHandle: username ? atUsername(username) : null,
      // Telegram vouches for who sent each message to the bot.
      fromVerified: true,
      subject: null,
      text: withQuote(text, quote),
      files,
      spam: false,
      thread: null,
    },
  } satisfies ChannelEvent;
}

// A reply carries what it answers as a quote above its text, the way an email reply does.
function withQuote(text: string, quote: TelegramQuote | null) {
  if (!quote) return text;

  const lines = quote.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

  const quoted = quote.fromName ? `${quote.fromName} wrote:\n${lines}` : lines;

  return [quoted, text].filter(Boolean).join("\n\n");
}
