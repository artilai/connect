import {
  Channel,
  type ChannelEvent,
  type SendOptions,
  type StartOptions,
} from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import { readRecipient, readSender } from "./conversations";
import type { InboundSlack, SlackProvider, SlackTokens } from "./provider";

// Slack through a provider, the Web API and Socket Mode in the server: an app's bot is an address,
// and a person or a channel the bot is in is whom a message goes to.
export class SlackChannel extends Channel {
  readonly kind = "slack";

  readonly name = "Slack";

  readonly labels = {
    address: "bot",
    contact: "member id or channel id",
    token: "bot token and app-level token, with a space between",
  };

  // Slack takes up to 12,000 characters of Markdown in a message, and files of up to 1 GB.
  override readonly limits = { recipients: 1, text: 12_000, files: 10, fileSize: 1_000_000_000 };

  readonly #provider: SlackProvider;

  constructor(provider: SlackProvider) {
    super();
    this.#provider = provider;
  }

  override async connect(token: string) {
    return this.#provider.connect(readTokens(token));
  }

  // The bot's messages come over Socket Mode, which the server opens, so Slack needs no webhook.
  override async start({ token, signal, receive }: StartOptions) {
    return this.#provider.start({
      tokens: readTokens(token),
      signal,
      onEvents: (events) => receive(events.map(({ message }) => received(message))),
    });
  }

  override parseSender(input: string) {
    return readSender(input) ?? null;
  }

  override parseRecipient(input: string) {
    return readRecipient(input) ?? null;
  }

  async send({ message: { to, text, files, replyTo }, token }: SendOptions) {
    if (!token) throw new Error("A Slack bot sends with its token");

    return this.#provider.send({
      token: readTokens(token).bot,
      to: onlyConversation(to),
      text,
      files,
      replyTo: replyTo ?? null,
    });
  }
}

// An app connects with both its tokens, told apart by how they start, in either order.
function readTokens(token: string): SlackTokens {
  const words = token.trim().split(/\s+/v);
  const bot = words.find((word) => word.startsWith("xoxb-"));
  const app = words.find((word) => word.startsWith("xapp-"));

  if (!bot || !app || words.length !== 2) {
    throw new AppError({
      code: "invalid_input",
      message:
        "A Slack app connects with its bot token, which starts with xoxb-, and its app-level token, which starts with xapp-, with a space between",
    });
  }

  return { bot, app };
}

function onlyConversation(to: string[]) {
  const [conversation, ...others] = to;

  if (!conversation || others.length > 0) {
    throw new AppError({
      code: "invalid_input",
      message: "A Slack message goes to one person or channel",
    });
  }

  return conversation;
}

function received({ id, bot, group, senderId, senderName, text, files, replyTo }: InboundSlack) {
  return {
    type: "message.received",
    message: {
      id,
      to: [bot],
      from: {
        address: senderId,
        name: senderName,
        // Slack has no handle of its own for a person, only the names they choose.
        username: null,
        // Slack vouches for who sent each message to the bot.
        verified: true,
      },
      // An answer to a message in a channel goes to the channel.
      group: group ? { address: group.id, name: group.name } : undefined,
      text,
      files,
      replyTo: replyTo ?? undefined,
    },
  } satisfies ChannelEvent;
}
