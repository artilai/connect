import {
  Channel,
  type ChannelEvent,
  type ReceiptOptions,
  type SendOptions,
  type StartOptions,
} from "@artil/channels/contract";
import { AppError } from "@artil/errors";
import { withQuotes } from "@artil/utils/text";

import { botAddress, channelAddress, readRecipient, readSender } from "./conversations";
import { newAppLink } from "./manifest";
import type { InboundSlack, SlackPerson, SlackProvider, SlackTokens } from "./provider";

// Slack through a provider, the Web API and Socket Mode in the server: an app's bot is an address,
// and a person or a channel the bot is in is whom a message goes to.
export class SlackChannel extends Channel {
  readonly kind = "slack";

  readonly name = "Slack";

  readonly labels = {
    address: "bot",
    contact: "email or #channel",
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
    return botAddress(await this.#provider.connect(readTokens(token)));
  }

  // The app for the account comes from a link, and its two tokens from its settings, asked for in
  // the order Slack shows them: the app-level token on the page a new app opens on, then the bot
  // token once the app is installed.
  override tokenParts(account: string) {
    return [
      {
        label: "app-level token (xapp-…)",
        guide: [
          `1. [Create the app in Slack](${newAppLink(account)})`,
          "2. On the Basic Information page it opens, generate an App-Level Token with the connections:write scope.",
        ].join("\n"),
      },
      {
        label: "bot token (xoxb-…)",
        guide:
          "3. Open Install App in its sidebar, choose Install to Workspace and Allow, and copy the Bot User OAuth Token it shows.",
      },
    ];
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
    return readSender(input);
  }

  override parseRecipient(input: string) {
    return readRecipient(input);
  }

  async send({ message: { to, text, files, replyTo, thread }, token }: SendOptions) {
    if (!token) throw new Error("A Slack bot sends with its token");

    return this.#provider.send({
      token: readTokens(token).bot,
      to: onlyConversation(to),
      text,
      files,
      replyTo: replyTo ?? null,
      thread: thread ?? null,
    });
  }

  override markRead(options: ReceiptOptions) {
    return this.#react(options, true);
  }

  override markAnswered(options: ReceiptOptions) {
    return this.#react(options, false);
  }

  // The bot puts 👀 on a message while the agent has it, and takes it off once the agent answers. A
  // bot the account no longer holds has no token to react with.
  async #react({ id, token }: ReceiptOptions, on: boolean) {
    if (token) await this.#provider.react({ token: readTokens(token).bot, id, name: "eyes", on });
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

// A person goes by their email, a bot by its @username, and someone Slack tells neither of by their
// member id.
function addressOf({ id, email, botUsername }: SlackPerson) {
  if (email) return email.toLowerCase();

  return botUsername ? botAddress(botUsername) : id;
}

function received({ id, botUsername, group, sender, text, files, quotes, thread }: InboundSlack) {
  // A channel goes by its #name, or by its id when Slack does not tell the name.
  const channel = group?.name ? channelAddress(group.name) : null;

  return {
    type: "message.received",
    message: {
      id,
      to: [botAddress(botUsername)],
      from: {
        address: addressOf(sender),
        name: sender.name,
        // Their member id, which a list may name in place of their email.
        username: sender.id,
        // Slack vouches for who sent each message to the bot.
        verified: true,
      },
      // An answer to a message in a channel goes to the channel.
      group: group ? { address: channel ?? group.id, name: channel } : undefined,
      // A mention in a thread carries what was said there before it.
      text: withQuotes(text, quotes),
      files,
      thread,
    },
  } satisfies ChannelEvent;
}
