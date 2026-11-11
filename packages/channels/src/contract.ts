/**
 * A file with a message: its description, and its bytes. One that came with a message has them
 * only when the channel hands them over.
 */
type Attachment = { name: string; type: string; size: number };

export type InboundFile = Attachment & { content: Uint8Array | null };

export type OutboundFile = Attachment & { content: Uint8Array };

/** Whom a message came from, as the channel knows them. */
export type Sender = {
  /** The sender's address on the channel, as the channel writes it and as an answer goes to it. */
  address: string;
  /** The name the sender goes by, when the channel tells it. */
  name: string | null;
  /**
   * Another address the sender goes by on the channel, like a username, which a list of senders
   * may name in place of the address. The sender can change it, and someone else can then take it.
   */
  handle: string | null;
  /** Whether the channel vouches for who sent the message. */
  verified: boolean;
};

/**
 * The account as it writes on the channel: its address there, what the provider needs to send from
 * it, like a bot's token, and its name.
 */
export type Author = { address: string; name: string; credentials: string | null };

/**
 * A message as it reached one of the account's addresses: what every channel has, whatever else its
 * provider adds.
 */
export type InboundMessage = {
  /** The channel's own id for the message, which an answer names it by. */
  externalId: string;
  /** The account's address the message came to. */
  to: string;
  /** Whoever wrote the message. */
  from: Sender;
  /**
   * The group the message came in, by its address there, which an answer goes to, and its name. A
   * message without one came straight to the account's address.
   */
  group?: { address: string; name: string | null };
  text: string;
  files: InboundFile[];
  /** Whether the provider marked the message as spam, on a channel whose provider does. */
  spam?: boolean;
};

/** A message the account sends, as the server hands it to the channel. */
export type OutboundMessage<Data = never> = {
  from: Author;
  to: string[];
  text: string;
  files: OutboundFile[];
  /**
   * The message this one answers, by the channel's own id for it, so the channel can thread the
   * answer the way it threads.
   */
  inReplyTo: { externalId: string } | null;
  /** What only the message's channel takes, in the shape that channel names. */
  channelData?: Data;
};

/** What a channel hands the server: new events come as new types. */
export type ChannelEvent = { type: "message.received"; message: InboundMessage };

/** An address the workspace holds with the provider, and what Artil needs to use it. */
export type ConnectedAddress = { address: string; credentials: string };

/**
 * Hands the server what reached a channel's addresses. A channel confirms events to its provider
 * only once this resolves, so the provider hands them over again after a failure.
 */
type ReceiveEvents = (events: ChannelEvent[]) => Promise<void>;

export type StartOptions = {
  credentials: string;
  /** Aborts once the address is disconnected or the server stops. */
  signal: AbortSignal;
  receive: ReceiveEvents;
  /** Tells of a failure the channel goes on after, like a provider it could not reach for a while. */
  onError: (cause: unknown) => void;
};

/**
 * The credentials of an address the workspace connected, which a provider may need to read what
 * reaches it, like a bot's token to fetch the files people send the bot.
 */
type CredentialsOf = (address: string) => Promise<string | null>;

export type HandleWebhookOptions = { credentialsOf: CredentialsOf; receive: ReceiveEvents };

/**
 * What every channel is, whatever carries its messages under the hood: a provider with an API, or
 * the server itself. A channel extends this class and overrides what it does differently from the
 * defaults here; Kind names it, and Data is what only it takes with a message it sends.
 */
export abstract class Channel<Kind extends string = string, Data = unknown> {
  /** The name the server, its commands and its config know the channel by. */
  abstract readonly kind: Kind;
  /** What people and agents call the channel, like Telegram. */
  abstract readonly name: string;
  /** Whom a message on the channel can go to, as an agent names them in to before it sends. */
  abstract readonly recipients: string;
  /** How a person names a sender for the list of who wakes the agent, which readSender reads. */
  readonly senders: string = "the sender as the channel writes them";
  /** What a person gives to connect an address, like the bot's token. */
  readonly credentials: string = "The address's credentials";
  /**
   * How a person gets them and what connecting does, in a few sentences the setup shows before it
   * asks; empty when the credentials need no explaining.
   */
  readonly credentialsGuide: string = "";

  /**
   * Checks the credentials of an address the workspace already holds with the provider, and finds
   * the address. A channel without it has its addresses by itself.
   */
  connect?(credentials: string): Promise<ConnectedAddress>;

  /** Lets go of an address that is disconnected, like a bot's webhook. */
  async disconnect(_address: ConnectedAddress): Promise<void> {}

  /**
   * Keeps what reaches a connected address coming to the server, in whatever way the channel
   * chooses: asking its provider until the signal aborts, or pointing the provider at a webhook.
   */
  async start(_options: StartOptions): Promise<void> {}

  /**
   * Takes what a provider posted to the server's webhook for the channel, and answers the provider;
   * a request the channel refuses throws, and the server answers with the error. A channel without
   * it takes no webhooks.
   */
  handleWebhook?(request: Request, options: HandleWebhookOptions): Promise<Response>;

  /** Reads a sender a person wrote as the channel writes their address; null for none it can have. */
  readSender(input: string): string | null {
    return input.trim() || null;
  }

  /**
   * Shows a sender on the list as a person knows them, like an account's name for the id the list
   * keeps. A channel without it shows the sender as readSender wrote it.
   */
  showSender?(sender: string): string;

  /** Whether a recipient has to write to the address before the agent can write to them. */
  recipientWritesFirst(_recipient: string): boolean {
    return false;
  }

  /** Checks a message before it goes and puts it the way the channel sends it. */
  prepare(message: OutboundMessage<Data>): OutboundMessage<Data> {
    return message;
  }

  abstract send(message: OutboundMessage<Data>): Promise<{ externalId: string }>;
}

/** What the server hands a channel it creates. */
export type ChannelContext = {
  /** Where the channel's provider posts to the server; none on a computer nothing can reach. */
  webhookUrl: string | undefined;
  /** The server's secret for this channel, to sign what only the server should accept. */
  secret: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  log: (line: string) => void;
};

/** What a channel's package exports, from which the server creates the channel. */
export type ChannelDefinition<Kind extends string = string> = {
  kind: Kind;
  create: (context: ChannelContext) => Channel<Kind>;
};
