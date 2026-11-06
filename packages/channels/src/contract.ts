export type Thread = { messageId: string; references: string[] };

export type Attachment = { name: string; type: string; size: number };

// A file that came with a message: its description, and its bytes when the channel hands them over.
export type InboundFile = Attachment & { content: Uint8Array | null };

// Whom a message names as its recipients and copies.
type Addressees = { to: string[]; cc: string[] };

export type InboundMessage = {
  externalId: string;
  // The agent's address the message came to.
  to: string;
  // Whom the message names; the agent's address is among them unless it got a blind copy.
  addressees: Addressees;
  from: string;
  // The name the sender goes by, when the channel tells it.
  fromName: string | null;
  // Another address the sender goes by on the channel, like a username, which a list of senders
  // may name in place of from. The sender can change it, and someone else can then take it.
  fromHandle: string | null;
  fromVerified: boolean;
  subject: string | null;
  text: string;
  files: InboundFile[];
  spam: boolean;
  thread: Thread | null;
};

export type ChannelEvent = { type: "message.received"; message: InboundMessage };

// A file to send with a message: its description, its bytes, and a link a provider that fetches
// media can use.
export type OutboundFile = Attachment & { content: Uint8Array; url: string };

export type OutboundMessage<Data = never> = {
  from: string;
  fromName: string;
  // What the provider needs to send from an address the workspace connected, like a bot's token.
  credentials: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  text: string;
  files: OutboundFile[];
  inReplyTo: Thread | null;
  // What only the message's channel takes, in the shape that channel names.
  channelData?: Data;
};

// The credentials of an address the workspace connected, which a provider may need to read what
// reaches it, like a bot's token to fetch the files people send the bot.
type CredentialsOf = (address: string) => Promise<string | null>;

// An address the workspace holds with the provider, and what Artil needs to use it.
type ConnectedAddress = { value: string; credentials: string };

// How a list of who wakes the agent names a sender on the channel.
type Senders = {
  // What a person writes, like a person's @username or user id.
  description: string;
  // Reads what a person wrote as the channel writes the sender in from; null for none it can have.
  read: (input: string) => string | null;
};

// Hands the server what reached a channel's addresses. A channel confirms events to its provider
// only once this resolves, so the provider hands them over again after a failure.
type ReceiveEvents = (events: ChannelEvent[]) => Promise<void>;

type StartOptions = {
  credentials: string;
  // Aborts once the address is disconnected or the server stops.
  signal: AbortSignal;
  receive: ReceiveEvents;
  // Tells of a failure the channel goes on after, like a provider it could not reach for a while.
  onError: (cause: unknown) => void;
};

type HandleWebhookOptions = { credentialsOf: CredentialsOf; receive: ReceiveEvents };

// What every channel implements, whatever carries its messages under the hood: a provider with an
// API, or the server itself. A channel names its kind, and Data is what only it takes with a
// message it sends.
export type Channel<Kind extends string = string, Data = never> = {
  kind: Kind;
  // What people and agents call the channel, like Telegram.
  name: string;
  // Whom a message on the channel can go to, as an agent names them in to before it sends.
  recipients: string;
  // Checks the credentials of an address the workspace already holds with the provider, and finds
  // the address.
  connect?: (credentials: string) => Promise<ConnectedAddress>;
  disconnect?: (address: ConnectedAddress) => Promise<void>;
  // What a person gives to connect an address, like the bot's token.
  credentials?: string;
  // Without it, a sender is named as the channel writes from.
  senders?: Senders;
  // Whether a message can copy others beside its recipients.
  canCopy?: true;
  // Whether a recipient has to write to the address before the agent can write to them.
  recipientWritesFirst?: (recipient: string) => boolean;
  // Keeps what reaches a connected address coming to the server, in whatever way the channel
  // chooses: asking its provider until the signal aborts, or pointing the provider at a webhook.
  start?: (options: StartOptions) => Promise<void>;
  // Takes what a provider posted to the server's webhook for the channel, and answers the provider.
  // A request the channel refuses throws, and the server answers with the error.
  handleWebhook?: (request: Request, options: HandleWebhookOptions) => Promise<Response>;
  prepare?: (message: OutboundMessage<Data>) => OutboundMessage<Data>;
  send: (message: OutboundMessage<Data>) => Promise<{ externalId: string }>;
};

// What the server hands a channel it creates.
export type ChannelContext = {
  // Where the channel's provider posts to the server; none on a computer nothing can reach.
  webhookUrl: string | undefined;
  // The server's secret for this channel, to sign what only the server should accept.
  secret: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  log: (line: string) => void;
};

// What a channel's package exports, from which the server creates the channel.
export type ChannelDefinition<Kind extends string = string> = {
  kind: Kind;
  create: (context: ChannelContext) => Channel<Kind>;
};
