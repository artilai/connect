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
  // The id of the message that starts the thread it is in.
  replyTo: string | null;
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
  // The id of the message this one answers, as Artil gave it, in whose thread the answer goes.
  replyTo: string | null;
};

export type SlackUpdates = {
  tokens: SlackTokens;
  signal: AbortSignal;
  // Takes the events of one envelope; Slack sends the envelope again until this resolves.
  onEvents: (events: SlackEvent[]) => Promise<void>;
};

export type SlackProvider = {
  // Checks the app's tokens and returns its bot's member id.
  connect: (tokens: SlackTokens) => Promise<string>;
  // Keeps the bot's messages coming over Socket Mode until the signal aborts, on any server, since
  // the server opens the connection.
  start: (updates: SlackUpdates) => Promise<void>;
  send: (message: OutgoingSlack) => Promise<{ id: string }>;
};
