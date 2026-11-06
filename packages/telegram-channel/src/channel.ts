import {
  Channel,
  type ChannelEvent,
  type ConnectedAddress,
  type HandleWebhookOptions,
  type OutboundMessage,
  type StartOptions,
} from "@artil/channels/contract";
import { AppError } from "@artil/errors";
import { formatBytes } from "@artil/utils/text";

import { atUsername, readChat, readSender } from "./chats";
import type { InboundTelegram, TelegramProvider, TelegramQuote } from "./provider";

const maxLength = 4096;

// A bot sends up to 10 files in one album, each of up to 50 MB.
const maxFiles = 10;

const maxFileSize = 50_000_000;

// Telegram through a provider, the Bot API in the server: a bot is an address, and a chat with it
// is whom a message goes to.
export class TelegramChannel extends Channel<"telegram"> {
  readonly kind = "telegram";

  readonly name = "Telegram";

  readonly recipients =
    "the id of someone who wrote to the agent's bot first, or a bot's @username";

  override readonly senders = "a person's @username or Telegram user id, or a bot's @username";

  override readonly credentials = "Bot token";

  // Short lines, which the setup shows as they are.
  override readonly credentialsGuide = [
    "Open @BotFather in Telegram.",
    "Send /newbot to make a bot, or /mybots to pick one you have.",
    "Tap API Token and copy it.",
    "",
    "Messages to the bot reach this account from now on.",
    "People write to the bot first, in private chats.",
    "Then the agent can answer.",
  ].join("\n");

  readonly #provider: TelegramProvider;

  constructor(provider: TelegramProvider) {
    super();
    this.#provider = provider;
  }

  override async connect(token: string) {
    return { address: atUsername(await this.#provider.connect(token)), credentials: token };
  }

  override async disconnect({ credentials }: ConnectedAddress) {
    await this.#provider.disconnect(credentials);
  }

  override start({ credentials, signal, receive, onError }: StartOptions) {
    return this.#provider.start({
      token: credentials,
      signal,
      onEvents: (events) => receive(events.map(({ message }) => received(message))),
      onError,
    });
  }

  override async handleWebhook(request: Request, { credentialsOf, receive }: HandleWebhookOptions) {
    const events = await this.#provider.verifyEvents(request, (bot) =>
      credentialsOf(atUsername(bot)),
    );

    await receive(events.map(({ message }) => received(message)));

    return new Response(null, { status: 204 });
  }

  override readSender(input: string) {
    return readSender(input) ?? null;
  }

  // A bot cannot start a chat with a person, but it can write first to another bot that takes
  // messages from bots.
  override recipientWritesFirst(chat: string) {
    return !chat.startsWith("@");
  }

  override prepare(message: OutboundMessage) {
    return prepareTelegram(message);
  }

  send({ from, to, text, files, inReplyTo }: OutboundMessage) {
    if (!from.credentials) throw new Error("A Telegram bot sends with its token");

    return this.#provider.send({
      token: from.credentials,
      chat: onlyChat(to),
      text,
      files,
      inReplyTo: inReplyTo?.externalId ?? null,
    });
  }
}

function onlyChat(to: string[]) {
  const [chat, ...others] = to;

  if (chat === undefined || others.length > 0) {
    throw new AppError({ code: "invalid_input", message: "A Telegram message goes to one chat" });
  }

  return chat;
}

function prepareTelegram(message: OutboundMessage) {
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

  return { ...message, to: [chat] };
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
      from: {
        address: fromBot ? atUsername(fromBot) : chat,
        // A person shows by their name and @username, the way Telegram shows them.
        name: fromName && username ? `${fromName} (@${username})` : fromName,
        handle: username ? atUsername(username) : null,
        // Telegram vouches for who sent each message to the bot.
        verified: true,
      },
      text: withQuote(text, quote),
      files,
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
