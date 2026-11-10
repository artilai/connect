import { Channel, type OutboundMessage } from "@artil/channels/contract";
import { AppError } from "@artil/errors";
import { day } from "@artil/utils/time";

import type { Upload } from "../../platform/storage";
import type { AccessService } from "../access/service";
import type { AccountsService } from "../accounts/service";
import type { ConnectionsService } from "../connections/service";
import type { EventsService } from "../events/service";
import type { AttachmentInput } from "../files/schema";
import type { FilesService } from "../files/service";
import { maxUrlText, type UrlData, urlKind } from "./schema";

// A message on the Message URL carries up to 10 files, which stay a day.
const maxUrlFiles = 10;

const filesLifetime = day;

const noThreads: UrlData = { thread: null, toThread: null, client: null };

function invalid(message: string) {
  return new AppError({ code: "invalid_input", message });
}

type UrlChannelOptions = {
  accounts: AccountsService;
  access: AccessService;
  connections: ConnectionsService;
  events: EventsService;
  files: FilesService;
};

type RelayOptions = {
  sender: { id: string; name: string };
  // The one account the message goes to, which the channel checks.
  to: string[];
  text: string;
  thread: string | null;
  toThread: string | null;
  client: string | null;
  // Files the sender has or wrote for the message, and ones uploaded with it.
  attachments: readonly AttachmentInput[];
  uploads: readonly Upload[];
};

// The Message URL: an account of the server writes to another, and the message goes whole to
// whoever listens to that account, as long as its list lets the sender wake it. It is the server's own
// channel: it extends Channel so that the commands, MCP and the setup describe it like the others,
// and it has no provider, so it sends through the server's services and is the url domain's service.
export class UrlChannel extends Channel<"url", UrlData> {
  readonly kind = urlKind;

  readonly name = "Message URL";

  readonly recipients = "the id of one agent from team.list";

  override readonly senders = "an account of this server, by its name or id";

  readonly #services: UrlChannelOptions;

  constructor(services: UrlChannelOptions) {
    super();
    this.#services = services;
  }

  // The list keeps an account by its id, as the sender of a message comes, which a rename leaves be.
  override readSender(input: string) {
    return this.#services.accounts.findByIdOrName(input)?.id ?? null;
  }

  override showSender(sender: string) {
    return this.#services.accounts.findById(sender)?.name ?? sender;
  }

  // Sends what an agent writes to another's Message URL, and returns the event the other got.
  async relay({ sender, to, text, thread, toThread, client, attachments, uploads }: RelayOptions) {
    const attachedFiles = await this.#services.files.readAttachments({
      accountId: sender.id,
      attachments,
    });

    const { event } = await this.send({
      // The Message URL has no credentials, and threads an answer by toThread instead.
      from: { address: sender.id, name: sender.name, credentials: null },
      to,
      text,
      files: [...attachedFiles, ...uploads],
      inReplyTo: null,
      channelData: { thread, toThread, client },
    });

    return event;
  }

  // Beside the message's id every channel gives, the event the account got, which the server hands
  // back to the sender.
  async send({
    from,
    to,
    text,
    files: uploads,
    channelData = noThreads,
  }: OutboundMessage<UrlData>) {
    const { accounts, access, connections, events, files } = this.#services;
    const [recipientId, ...others] = to;

    if (recipientId === undefined || others.length > 0) {
      throw invalid("Put the id of the one agent to send to in to");
    }

    if (text.length > maxUrlText) {
      throw invalid(`A message on url holds at most ${maxUrlText} characters`);
    }

    if (uploads.length > maxUrlFiles) {
      throw invalid(`A message on url carries at most ${maxUrlFiles} files`);
    }

    // Without a thread, an account writing to itself would only answer itself.
    if (from.address === recipientId && channelData.thread === null) {
      throw invalid("An agent cannot send to its own Message URL, except from a thread to another");
    }

    const recipient = accounts.findById(recipientId);

    if (!recipient) {
      throw new AppError({ code: "not_found", message: "Agent account not found" });
    }

    // The sender is the account whose token signed the request, so it is on the team and
    // verified; an account's own threads write to each other whatever its list says.
    const { refusal } = access.decide({
      accountId: recipient.id,
      channel: this.kind,
      from: from.address,
      handle: null,
      fromSelf: false,
      spam: false,
      fromTeam: true,
      fromVerified: true,
      listed: from.address === recipient.id,
    });

    if (refusal) {
      throw new AppError({
        code: "forbidden",
        message: `${recipient.name} does not take messages from you at its Message URL`,
      });
    }

    if (!connections.isListening(recipient.id)) {
      throw new AppError({
        code: "conflict",
        message: `No one is listening to ${recipient.name}: start its client, and turn on new messages there with: artil listen on`,
      });
    }

    if (uploads.length > 0 && !files.enabled) throw files.unavailableError();

    const messageId = crypto.randomUUID();

    // The files go in before the event, so the agent never hears of a message without them.
    await files.save({
      accountId: recipient.id,
      messageId,
      uploads,
      expiresAt: new Date(Date.now() + filesLifetime),
    });

    const event = events.relay({
      accountId: recipient.id,
      event: {
        type: "message.received",
        channel: this.kind,
        messageId,
        text: text || null,
        sender: { id: from.address, name: from.name },
        ...channelData,
      },
    });

    return { externalId: messageId, event };
  }
}
