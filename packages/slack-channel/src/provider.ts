import type { InboundFile, OutboundFile } from "@artil/channels/contract";

// What connects a Slack app: its bot token, which reads and sends as the bot, and its app-level
// token, which opens the Socket Mode connection the bot's messages come on.
export type SlackTokens = { bot: string; app: string };

// A message someone sent an app's bot: in a direct message with it, or in a channel where they
// mention it.
export type InboundSlack = {
  id: string;
  // The bot's member id.
  bot: string;
  // The channel it came in, by its id and the name people see; none for a direct message.
  group: { id: string; name: string | null } | null;
  // The member id of whoever wrote it.
  senderId: string;
  senderName: string | null;
  text: string;
  files: InboundFile[];
  // The thread it is in, by the id of the message that starts it, which may be itself.
  thread: string;
};

export type SlackEvent = { type: "received"; message: InboundSlack };

export type OutgoingSlack = {
  // The bot token.
  token: string;
  // A conversation by its id, or a person by their member id, whom the bot writes in a direct
  // message.
  to: string;
  text: string;
  files: OutboundFile[];
  // The id of the message this one answers, and the thread it is in, which the answer goes in.
  replyTo: string | null;
  thread: string | null;
};

export type SlackUpdates = {
  tokens: SlackTokens;
  signal: AbortSignal;
  // Takes the events of one envelope, which Slack has as delivered once the server acknowledged it.
  onEvents: (events: SlackEvent[]) => Promise<void>;
};

export type SlackProvider = {
  // Checks the app's tokens and returns its bot's member id.
  connect: (tokens: SlackTokens) => Promise<string>;
  // Keeps the bot's messages coming over Socket Mode until the signal aborts, on any server, since
  // the server opens the connection.
  start: (updates: SlackUpdates) => Promise<void>;
  // Sends the message, and returns its id and the thread it went in.
  send: (message: OutgoingSlack) => Promise<{ id: string; thread: string }>;
};
