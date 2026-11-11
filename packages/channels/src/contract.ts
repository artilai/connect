export const contractVersion = 1;

/**
 * A file with a message: its description, and its bytes. One that came with a message has them
 * only when the channel hands them over.
 */
type Attachment = { name: string; type: string; size: number };

export type InboundFile = Attachment & { content: Uint8Array | null };

export type OutboundFile = Attachment & { content: Uint8Array };

export type Sender = {
  address: string;
  name: string | null;
  username: string | null;
  verified: boolean;
};

export type InboundMessage = {
  id: string;
  from: Sender;
  to: string[];
  group?: { address: string; name: string | null };
  text: string;
  files: InboundFile[];
};

export type OutboundMessage<Data = never> = {
  from: string;
  to: string[];
  text: string;
  files: OutboundFile[];
  replyTo?: string;
  channelData?: Data;
};

export type SendOptions<Data = never> = {
  message: OutboundMessage<Data>;
  credentials: string | null;
};

/** What a channel hands the server: new events come as new types. */
export type ChannelEvent = { type: "message.received"; message: InboundMessage };

export type ChannelLabels = { contact: string; token?: string };

export type ChannelLimits = { recipients: number; text: number; files: number; fileSize?: number };

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
  readonly contractVersion = contractVersion;
  /** The name the server, its commands and its config know the channel by. */
  abstract readonly kind: Kind;
  abstract readonly name: string;
  abstract readonly labels: ChannelLabels;
  readonly limits: ChannelLimits = { recipients: 1, text: 32_000, files: 10 };

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

  parseSender(input: string): string | null {
    return input.trim() || null;
  }

  parseRecipient(input: string): string | null {
    return input.trim() || null;
  }

  /** Whether a recipient has to write to the address before the agent can write to them. */
  recipientWritesFirst(_recipient: string): boolean {
    return false;
  }

  abstract send(options: SendOptions<Data>): Promise<{ id: string }>;
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
