import { Channel, type OutboundFile, type OutboundMessage } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

// A message on the Message URL holds up to 2000 characters and 10 files.
export const maxUrlText = 2000;

const maxUrlFiles = 10;

// The threads a message goes between: the one of the sender's client it comes from, and the one
// of the agent's client it is for. A thread is whatever a client calls its conversation, like a
// Codex thread id.
export type UrlData = {
  thread: string | null;
  toThread: string | null;
  // The client the sender writes in, like Codex, which the agent sees beside the sender's name.
  client: string | null;
};

type UrlAgent = { id: string; name: string };

// A message the Message URL hands whole to an agent.
export type UrlDelivery = UrlData & {
  from: UrlAgent;
  to: UrlAgent;
  text: string | null;
  files: OutboundFile[];
};

// Why the agent does not take a message, as the server's list of who wakes it decides.
export type UrlRefusal = { code: string; reason: string };

type AdmitOptions = {
  agentId: string;
  senderId: string;
  // Whether the sender counts as on the agent's list, whatever the list says.
  listed: boolean;
};

// What the server that carries the Message URL does for it: it knows the agents, decides by each
// agent's list who wakes it, knows who listens, and hands a message over.
export type UrlChannelHost = {
  findAgent: (id: string) => Promise<UrlAgent | undefined>;
  admit: (options: AdmitOptions) => Promise<UrlRefusal | null>;
  isListening: (agentId: string) => Promise<boolean>;
  // Hands the message to the agent's listening client, and returns the message's id.
  handOver: (delivery: UrlDelivery) => Promise<string>;
};

const noThreads = { thread: null, toThread: null, client: null } satisfies UrlData;

function invalid(message: string) {
  return new AppError({ code: "invalid_input", message });
}

type RefusalErrorOptions = { refusal: UrlRefusal; name: string };

function refusalError({ refusal, name }: RefusalErrorOptions) {
  switch (refusal.code) {
    case "sender":
      return new AppError({
        code: "forbidden",
        message: `${name} does not take messages from you at its Message URL`,
      });
    case "rate_limit":
      return new AppError({
        code: "rate_limited",
        message: `${name} got too many messages in the last hour; try again later`,
      });
    default:
      return new AppError({ code: "forbidden", message: refusal.reason });
  }
}

// The Message URL: an agent of the server writes to another, and the message goes whole to whoever
// listens to that agent, as long as its list lets the sender wake it.
export class UrlChannel extends Channel<"url", UrlData> {
  readonly kind = "url";

  readonly name = "Message URL";

  readonly recipients = "the id of one agent from team.list";

  readonly #host: UrlChannelHost;

  constructor(host: UrlChannelHost) {
    super();
    this.#host = host;
  }

  async send({ from, to, cc, text, files, channelData = noThreads }: OutboundMessage<UrlData>) {
    const [recipientId, ...others] = to;

    if (recipientId === undefined || others.length > 0) {
      throw invalid("Put the id of the one agent to send to in to");
    }

    if (cc.length > 0) throw invalid("A message on url copies no one");

    if (text.length > maxUrlText) {
      throw invalid(`A message on url holds at most ${maxUrlText} characters`);
    }

    if (files.length > maxUrlFiles) {
      throw invalid(`A message on url carries at most ${maxUrlFiles} files`);
    }

    // Without a thread, an agent writing to itself would only answer itself.
    if (from === recipientId && channelData.thread === null) {
      throw invalid("An agent cannot send to its own Message URL, except from a thread to another");
    }

    const recipient = await this.#host.findAgent(recipientId);
    const sender = await this.#host.findAgent(from);

    if (!recipient) {
      throw new AppError({ code: "not_found", message: "Agent account not found" });
    }

    if (!sender) throw new AppError({ code: "forbidden", message: "Only the team can send here" });

    // An agent's own threads write to each other whatever its list says.
    const refusal = await this.#host.admit({
      agentId: recipient.id,
      senderId: sender.id,
      listed: sender.id === recipient.id,
    });

    if (refusal) throw refusalError({ refusal, name: recipient.name });

    if (!(await this.#host.isListening(recipient.id))) {
      throw new AppError({
        code: "conflict",
        message: `No one is listening to ${recipient.name}; write to it at another of its addresses`,
      });
    }

    const messageId = await this.#host.handOver({
      from: sender,
      to: recipient,
      text: text || null,
      files,
      ...channelData,
    });

    return { externalId: messageId };
  }
}
