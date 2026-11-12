import type { InboundFile, OutboundFile } from "@artil/channels/contract";
import type { Quote } from "@artil/utils/text";

// What connects a Slack app: its bot token, which reads and sends as the bot, and its app-level
// token, which opens the Socket Mode connection the bot's messages come on.
export type SlackTokens = { bot: string; app: string };

// A message someone sent an app's bot: in a direct message with it, or in a channel where they
// mention it.
export type InboundSlack = {
  id: string;
  botUsername: string;
  // The channel it came in, by its id and its name when Slack tells it; none for a direct message.
  group: { id: string; name: string | null } | null;
  sender: SlackPerson;
  text: string;
  files: InboundFile[];
  // What was said in its thread since the bot last wrote there, which the bot hears only now.
  quotes: Quote[];
  // The thread it is in, by the id of the message that starts it, which may be itself.
  thread: string;
};

// Whoever wrote a message, as Slack tells: their member id, the name they go by, their email when
// Slack shows it, and their username when they are a bot.
export type SlackPerson = {
  id: string;
  name: string | null;
  email: string | null;
  botUsername: string | null;
};

export type SlackEvent = { type: "received"; message: InboundSlack };

export type OutgoingSlack = {
  // The bot token.
  token: string;
  // A channel by its id or #name, or a person by their member id or email, whom the bot writes in a
  // direct message.
  to: string;
  text: string;
  files: OutboundFile[];
  // The id of the message this one answers, and the thread it is in, which the answer goes in.
  replyTo: string | null;
  thread: string | null;
};

// The bot's reaction to a message it received, by the id Artil gave the message, by the name Slack
// gives the emoji, which the bot puts on or takes off.
export type SlackReaction = { token: string; id: string; name: string; on: boolean };

export type SlackUpdates = {
  tokens: SlackTokens;
  signal: AbortSignal;
  // Takes the events of one envelope, which Slack has as delivered once the server acknowledged it.
  onEvents: (events: SlackEvent[]) => Promise<void>;
};

export type SlackProvider = {
  // Checks the app's tokens and returns its bot's username.
  connect: (tokens: SlackTokens) => Promise<string>;
  // Keeps the bot's messages coming over Socket Mode until the signal aborts, on any server, since
  // the server opens the connection.
  start: (updates: SlackUpdates) => Promise<void>;
  // Sends the message, and returns its id and the thread it went in.
  send: (message: OutgoingSlack) => Promise<{ id: string; thread: string }>;
  react: (reaction: SlackReaction) => Promise<void>;
};
