import type { InboundFile, OutboundFile } from "@artil/channels/contract";
import type { Quote } from "@artil/utils/text";

// A message someone sent a bot: in a private chat with it, or in a group where it tags the bot or
// answers it.
export type InboundTelegram = {
  id: string;
  bot: string;
  // The chat it came in: a person's private chat with the bot, which goes by their user id, or a
  // group.
  chat: string;
  // The group's title, when the chat is a group.
  group: { title: string | null } | null;
  // The Telegram user id of whoever wrote it.
  senderId: string;
  // The sender's username when the sender is a bot itself.
  fromBot: string | null;
  // The username a person goes by, if they chose one.
  username: string | null;
  fromName: string | null;
  text: string;
  files: InboundFile[];
  // The message a reply answers, or only the part of it the sender quoted.
  quote: Quote | null;
  // The id of the message this one answers, in the same chat.
  replyTo: string | null;
};

export type TelegramEvent = { type: "received"; message: InboundTelegram };

export type OutgoingTelegram = {
  token: string;
  chat: string;
  text: string;
  files: OutboundFile[];
  // The id of the message this one answers, as Telegram gave it, which the answer quotes.
  replyTo: string | null;
};

// The bot's reaction to a message it received, by the id Artil gave the message, like 👀, or none
// to take its reaction off.
export type TelegramReaction = { token: string; id: string; emoji: string | null };

export type TelegramUpdates = {
  token: string;
  // Where Telegram posts the bot's updates; without it, the provider asks Telegram for them.
  webhookUrl?: string;
  webhookSecret: string;
  signal: AbortSignal;
  // Takes a batch of updates; Telegram sends the batch again until this resolves.
  onEvents: (events: TelegramEvent[]) => Promise<void>;
};

// An update Telegram posted to the server's webhook, with the token of each bot, to fetch the
// files people send it.
type TelegramWebhook = {
  request: Request;
  webhookSecret: string;
  tokenOf: (bot: string) => Promise<string | null>;
};

export type TelegramProvider = {
  // Checks the bot's token and returns the bot's username.
  connect: (token: string) => Promise<string>;
  disconnect: (token: string) => Promise<void>;
  // Reads an update Telegram posted to the server's webhook, and fetches the files people send
  // the bot with the bot's token.
  verifyEvents: (webhook: TelegramWebhook) => Promise<TelegramEvent[]>;
  // Keeps the bot's updates coming: points Telegram at the server's webhook, or asks Telegram for
  // them until the signal aborts on a server Telegram cannot reach.
  start: (updates: TelegramUpdates) => Promise<void>;
  send: (message: OutgoingTelegram) => Promise<{ id: string }>;
  react: (reaction: TelegramReaction) => Promise<void>;
};
