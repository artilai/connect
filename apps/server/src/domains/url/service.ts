import { Channel, type SendOptions } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import type { Upload } from "../../platform/storage";
import type { AccessService } from "../access/service";
import type { AccountsService } from "../accounts/service";
import { checkLimits, readRecipients } from "../channels/service";
import type { ConnectionsService } from "../connections/service";
import type { RelayRecord } from "../events/schema";
import type { AttachmentInput } from "../files/schema";
import type { FilesService } from "../files/service";
import { maxUrlText, type UrlData, type UrlDelivery, urlKind } from "./schema";

const noThreads: UrlData = { thread: null, toThread: null, client: null };

function invalid(message: string) {
  return new AppError({ code: "invalid_input", message });
}

type UrlChannelOptions = {
  accounts: AccountsService;
  access: AccessService;
  connections: ConnectionsService;
  files: FilesService;
  // Keeps the message among the messages of both accounts and wakes the one it is for, which the
  // messages service does as it does for every channel.
  receiveRelay: (delivery: UrlDelivery) => Promise<RelayRecord>;
};

type RelayOptions = {
  // The account that sends.
  from: string;
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
export class UrlChannel extends Channel<UrlData> {
  readonly kind = urlKind;

  readonly name = "Message URL";

  readonly labels = { contact: "account name or id" };

  override readonly limits = { recipients: 1, text: maxUrlText, files: 10 };

  readonly #services: UrlChannelOptions;

  constructor(services: UrlChannelOptions) {
    super();
    this.#services = services;
  }

  // An account goes by its id on lists and as whom a message goes to, which a rename leaves be.
  override parseSender(input: string) {
    return this.#accountIdOf(input);
  }

  override parseRecipient(input: string) {
    return this.#accountIdOf(input);
  }

  #accountIdOf(input: string) {
    return this.#services.accounts.findByIdOrName(input)?.id ?? null;
  }

  // Sends what an agent writes to another's Message URL, and returns the event the other got.
  async relay({ from, to, text, thread, toThread, client, attachments, uploads }: RelayOptions) {
    const attachedFiles = await this.#services.files.readAttachments({
      accountId: from,
      attachments,
    });

    const outgoingFiles = [...attachedFiles, ...uploads];

    checkLimits({ channel: this, text, files: outgoingFiles });

    const { event } = await this.send({
      // The Message URL threads an answer by toThread, and needs no token.
      message: {
        from,
        to: readRecipients({ channel: this, to }),
        text,
        files: outgoingFiles,
        channelData: { thread, toThread, client },
      },
      token: null,
    });

    return event;
  }

  // Beside the message's id every channel gives, the event the account got, which the server hands
  // back to the sender.
  async send({ message }: SendOptions<UrlData>) {
    const { from, to, text, files: uploads, channelData = noThreads } = message;
    const { accounts, access, connections, files, receiveRelay } = this.#services;
    const [recipientId] = to;

    if (!recipientId) throw invalid("Put the id of the one agent to send to in to");

    // Without a thread, an account writing to itself would only answer itself.
    if (from === recipientId && channelData.thread === null) {
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
      from,
      username: null,
      group: null,
      fromSelf: false,
      fromTeam: true,
      fromVerified: true,
      listed: from === recipient.id,
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

    const event = await receiveRelay({
      from: { id: from, name: accounts.findById(from)?.name ?? from },
      to: recipient.id,
      text,
      files: uploads,
      ...channelData,
    });

    return { id: event.messageId, event };
  }
}
