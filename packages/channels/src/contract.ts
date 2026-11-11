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
};

export type OutboundMessage<Data = never> = {
  from: string;
  to: string[];
  text: string;
  files: OutboundFile[];
  replyTo?: string;
  channelData?: Data;
};

export type ChannelEvent = { type: "message.received"; message: InboundMessage };

export type ChannelLabels = { address: string; contact: string; token?: string };

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

export type SendOptions<Data = never> = { message: OutboundMessage<Data>; token: string | null };

export abstract class Channel<Data = unknown> {
  readonly contractVersion = contractVersion;
  abstract readonly kind: string;
  abstract readonly name: string;
  abstract readonly labels: ChannelLabels;
  readonly limits: ChannelLimits = { recipients: 1, text: 32_000, files: 10 };

  connect?(token: string): Promise<string>;

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

  abstract send(options: SendOptions<Data>): Promise<{ id: string }>;
}
