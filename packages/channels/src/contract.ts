export const contractVersion = 1;

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
  replyTo?: string;
  // The provider's thread the message is in, which every message in it names alike, like a Slack
  // thread.
  thread?: string;
};

export type OutboundMessage = {
  from: string;
  to: string[];
  text: string;
  files: OutboundFile[];
  replyTo?: string;
  // The thread of the message this one answers, which the answer goes in.
  thread?: string;
};

// What the provider took: the message's id, and the thread it went in, on a provider with threads.
export type SentMessage = { id: string; thread?: string };

export type ChannelEvent = { type: "message.received"; message: InboundMessage };

export type ChannelLabels = { address: string; contact: string; token?: string };

// A part of the token connecting an address takes: what to call it, and how to get it, which a
// terminal shows before it asks for it.
export type TokenPart = { label: string; guide?: string };

export type ChannelLimits = { recipients: number; text: number; files: number; fileSize?: number };

type ReceiveEvents = (events: ChannelEvent[]) => Promise<void>;

export type StartOptions = {
  token: string;
  webhookUrl?: string;
  webhookSecret: string;
  signal: AbortSignal;
  receive: ReceiveEvents;
};

export type HandleWebhookOptions = {
  webhookSecret: string;
  tokenOf: (address: string) => Promise<string | null>;
  receive: ReceiveEvents;
};

export type SendOptions = {
  message: OutboundMessage;
  token: string | null;
  deliver: (message: InboundMessage) => Promise<void>;
};

export type ReceiptOptions = { id: string; token: string | null };

export abstract class Channel {
  readonly contractVersion = contractVersion;
  abstract readonly kind: string;
  abstract readonly name: string;
  abstract readonly labels: ChannelLabels;
  readonly limits: ChannelLimits = { recipients: 1, text: 32_000, files: 10 };

  connect?(token: string): Promise<string>;

  // The parts of the token connecting an address for the account takes, like a bot token and an
  // app-level token, which a terminal asks for one by one and gives connect with a space between.
  // Without them, a terminal asks for the token whole, by labels.token.
  tokenParts?(account: string): TokenPart[];

  async disconnect(_token: string): Promise<void> {}

  async start(_options: StartOptions): Promise<void> {}

  handleWebhook?(request: Request, options: HandleWebhookOptions): Promise<Response>;

  parseSender(input: string): string | null {
    return input.trim() || null;
  }

  parseRecipient(input: string): string | null {
    return input.trim() || null;
  }

  recipientWritesFirst(_recipient: string): boolean {
    return false;
  }

  abstract send(options: SendOptions): Promise<SentMessage>;

  markRead?(options: ReceiptOptions): Promise<void>;

  markAnswered?(options: ReceiptOptions): Promise<void>;
}
