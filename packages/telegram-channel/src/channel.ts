import {
  Channel,
  type ChannelEvent,
  type HandleWebhookOptions,
  type ReceiptOptions,
  type SendOptions,
  type StartOptions,
} from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import { atUsername, readChat, readSender } from "./chats";
import type { InboundTelegram, TelegramProvider, TelegramQuote } from "./provider";

// Telegram through a provider, the Bot API in the server: a bot is an address, and a chat with it,
// private or in a group, is whom a message goes to.
export class TelegramChannel extends Channel {
  readonly kind = "telegram";

  readonly name = "Telegram";

  readonly labels = {
    address: "bot",
    contact: "user id, group id or @username",
    token: "bot token from @BotFather",
  };

  // A bot sends up to 10 files in one album, each of up to 50 MB.
  override readonly limits = { recipients: 1, text: 4096, files: 10, fileSize: 50_000_000 };

  readonly #provider: TelegramProvider;

  constructor(provider: TelegramProvider) {
    super();
    this.#provider = provider;
  }

  override async connect(token: string) {
    return atUsername(await this.#provider.connect(token));
  }

  override async disconnect(token: string) {
    await this.#provider.disconnect(token);
  }

  override start({ token, webhookUrl, webhookSecret, signal, receive }: StartOptions) {
    return this.#provider.start({
      token,
      webhookUrl,
      webhookSecret,
      signal,
      onEvents: (events) => receive(events.map(({ message }) => received(message))),
    });
  }

  override async handleWebhook(
    request: Request,
    { webhookSecret, tokenOf, receive }: HandleWebhookOptions,
  ) {
    const events = await this.#provider.verifyEvents({
      request,
      webhookSecret,
      tokenOf: (bot) => tokenOf(atUsername(bot)),
    });

    await receive(events.map(({ message }) => received(message)));

    return new Response(null, { status: 204 });
  }

  override parseSender(input: string) {
    return readSender(input) ?? null;
  }

  // A bot writes to a person by the id of their chat with it, never by their @username.
  override parseRecipient(input: string) {
    const chat = readChat(input);

    if (!chat && readSender(input)) {
      throw new AppError({
        code: "invalid_input",
        message: `A bot writes to a person by their user id, which comes with their first message, not by ${input.trim()}`,
      });
    }

    return chat ?? null;
  }

  // A bot cannot start a chat with a person or a group, but it can write first to another bot that
  // takes messages from bots.
  override recipientWritesFirst(chat: string) {
    return !chat.startsWith("@");
  }

  send({ message: { to, text, files, replyTo }, token }: SendOptions) {
    if (!token) throw new Error("A Telegram bot sends with its token");

    return this.#provider.send({
      token,
      chat: onlyChat(to),
      text,
      files,
      replyTo: replyTo ?? null,
    });
  }

  override markRead(options: ReceiptOptions) {
    return this.#react(options, "👀");
  }

  override markAnswered(options: ReceiptOptions) {
    return this.#react(options, null);
  }

  // A bot the account no longer holds has no token to react with.
  async #react({ id, token }: ReceiptOptions, emoji: string | null) {
    if (token) await this.#provider.react({ token, id, emoji });
  }
}

function onlyChat(to: string[]) {
  const [chat, ...others] = to;

  if (!chat || others.length > 0) {
    throw new AppError({ code: "invalid_input", message: "A Telegram message goes to one chat" });
  }

  return chat;
}

function received({
  id,
  bot,
  chat,
  group,
  senderId,
  fromBot,
  username,
  fromName,
  text,
  files,
  quote,
  replyTo,
}: InboundTelegram) {
  return {
    type: "message.received",
    message: {
      id,
      to: [atUsername(bot)],
      from: {
        address: fromBot ? atUsername(fromBot) : senderId,
        // A person shows by their name and @username, the way Telegram shows them.
        name: fromName && username ? `${fromName} (@${username})` : fromName,
        username: username ? atUsername(username) : null,
        // Telegram vouches for who sent each message to the bot.
        verified: true,
      },
      // An answer to a message in a group goes to the group.
      group: group ? { address: chat, name: group.title } : undefined,
      text: withQuote(text, quote),
      files,
      replyTo: replyTo ?? undefined,
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
