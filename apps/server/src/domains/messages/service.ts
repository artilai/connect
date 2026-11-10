import type { InboundMessage } from "@artil/channels/contract";
import { AppError, messageOf } from "@artil/errors";
import { shellQuoted } from "@artil/utils/shell";

import { missingChannel, onlyInCloud } from "../../platform/cloud";
import type { Upload } from "../../platform/storage";
import type { Refusal } from "../access/schema";
import type { AccessService } from "../access/service";
import type { AccountsService } from "../accounts/service";
import type { AddressesService } from "../addresses/service";
import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import type { RelayRecord } from "../events/schema";
import type { EventsService } from "../events/service";
import type { FilesService } from "../files/service";
import type { UrlChannel } from "../url/service";
import type { MessageFilter, MessagesRepository } from "./repository";
import type { Draft, MessageRecord, MessageRow } from "./schema";

const recipientSeparator = ", ";

// The refusals a person mends by putting the sender on the account's list.
const keptOut: ReadonlySet<Refusal> = new Set(["sender", "outsider"]);

type CreateMessagesServiceOptions = {
  messagesRepository: MessagesRepository;
  accounts: AccountsService;
  files: FilesService;
  addresses: AddressesService;
  access: AccessService;
  events: EventsService;
  channels: ChannelsService;
  url: UrlChannel;
  log: (line: string) => void;
};

type ListKeptOutOptions = { accountId: string; channel: ChannelKind };

type ReceiveOptions = { channel: ChannelKind; message: InboundMessage };

type SendOptions = { accountId: string; accountName: string; draft: Draft; uploads: Upload[] };

type SendDraftOptions = SendOptions & {
  // The client the agent writes in, which a relayed message names.
  client: string | null;
};

type ListOptions = { accountId: string; filter: MessageFilter };

type FindOptions = { accountId: string; id: string };

type Recipients = {
  channel: ChannelKind;
  to: string[];
  inReplyTo: { externalId: string } | null;
};

// What came of a message an agent wrote: the server keeps one in the account's inbox, and relays
// one on a channel without an inbox whole to the other account.
type Sent =
  | { kind: "stored"; message: MessageRecord }
  | { kind: "relayed"; event: RelayRecord; to: string[] };

// An answer goes to whoever wrote the message, or to whom the agent wrote it.
function replyRecipients(message: MessageRow): string[] {
  return message.direction === "inbound" ? [message.counterpart] : message.to;
}

// What no channel of this server carries: forwarding, copies and subjects are email's, in Artil
// Cloud.
function checkCarried(draft: Draft, kind: ChannelKind) {
  if (draft.forward !== undefined) throw onlyInCloud("Forwarding a message");

  if ((draft.cc ?? []).length > 0) {
    throw new AppError({ code: "invalid_input", message: `A message on ${kind} copies no one` });
  }

  if (draft.subject) {
    throw new AppError({ code: "invalid_input", message: `A message on ${kind} has no subject` });
  }
}

export function createMessagesService({
  messagesRepository,
  accounts,
  files,
  addresses,
  access,
  events,
  channels,
  url,
  log,
}: CreateMessagesServiceOptions) {
  function toRecords(rows: MessageRow[]): MessageRecord[] {
    const attachmentsByMessage = files.describeByMessages(rows.map(({ id }) => id));

    return rows.map(({ accountId: _accountId, externalId: _externalId, ...message }) => ({
      ...message,
      attachments: attachmentsByMessage.get(message.id) ?? [],
    }));
  }

  function find(options: FindOptions) {
    const row = messagesRepository.find(options);

    return row && toRecords([row])[0];
  }

  // An answer goes where its message came from, a new message where the draft says.
  function resolveRecipients(accountId: string, draft: Draft): Recipients {
    if (draft.replyTo === undefined) {
      if (!draft.channel || !draft.to) {
        throw new AppError({
          code: "invalid_input",
          message: "Give replyTo to answer a message, or a channel and recipients in to",
        });
      }

      return { channel: draft.channel, to: draft.to, inReplyTo: null };
    }

    const repliedMessage = messagesRepository.find({ accountId, id: draft.replyTo });

    if (!repliedMessage) throw new AppError({ code: "not_found", message: "Message not found" });

    return {
      channel: repliedMessage.channel,
      to: draft.to ?? replyRecipients(repliedMessage),
      // The channel threads the answer by its own id for the message, when it gave one.
      inReplyTo:
        repliedMessage.externalId === null ? null : { externalId: repliedMessage.externalId },
    };
  }

  // Sends on a channel with addresses, and keeps the message among the account's.
  async function send({ accountId, accountName, draft, uploads }: SendOptions) {
    const { channel: kind, to, inReplyTo } = resolveRecipients(accountId, draft);

    checkCarried(draft, kind);

    const channel = channels.find(kind);

    if (!channel) throw missingChannel(kind);

    const address = addresses.findByAccount({ accountId, channel: kind });

    if (!address) {
      throw new AppError({
        code: "invalid_input",
        message: `${accountName} has no ${channel.name} address; connect one with: artil-server account connect ${shellQuoted(accountName)} ${kind}`,
      });
    }

    const attachments = await files.readAttachments({
      accountId,
      attachments: draft.attachments ?? [],
    });

    const outgoingFiles = [...attachments, ...uploads];

    if (outgoingFiles.length > 0 && !files.enabled) throw files.unavailableError();

    const prepared = channel.prepare({
      from: { address: address.value, name: accountName, credentials: address.credentials },
      to,
      text: draft.text,
      files: outgoingFiles,
      inReplyTo,
    });

    for (const recipient of prepared.to) {
      const mustWriteFirst =
        channel.recipientWritesFirst(recipient) &&
        !messagesRepository.hasReceivedFrom({ accountId, channel: kind, counterpart: recipient });

      if (mustWriteFirst) {
        throw new AppError({
          code: "invalid_input",
          message: `${recipient} has to write to ${address.value} before ${accountName} can write to them`,
        });
      }
    }

    const id = crypto.randomUUID();

    messagesRepository.add({
      id,
      accountId,
      addressId: address.id,
      channel: kind,
      direction: "outbound",
      counterpart: prepared.to.join(recipientSeparator),
      to: prepared.to,
      text: prepared.text,
      status: "sending",
    });

    try {
      await files.save({ accountId, messageId: id, uploads: outgoingFiles });

      const { externalId } = await channel.send(prepared);

      messagesRepository.markSent(id, externalId);
    } catch (cause) {
      const reason = messageOf(cause, "the provider gave no reason");

      messagesRepository.markFailed(id, reason);

      throw cause instanceof AppError
        ? cause
        : new AppError({
            code: "unavailable",
            message: `${channel.name} did not take the message: ${reason}`,
            cause,
          });
    }

    const sent = find({ accountId, id });

    if (!sent) throw new Error(`Message ${id} went missing`);

    return sent;
  }

  type LogKeptOutOptions = { accountId: string; channel: ChannelKind; message: InboundMessage };

  // Lets them in by their address, which stays theirs, where a handle can pass to someone else.
  function logKeptOut({ accountId, channel, message }: LogKeptOutOptions) {
    const accountName = accounts.findById(accountId)?.name ?? accountId;
    const { address, handle, name } = message.from;
    const goesBy = handle ?? address;
    const named = name ? `${name} (${goesBy})` : goesBy;

    log(
      `${named} wrote to ${accountName} on ${channels.find(channel)?.name ?? channel} but is not on its list; let them in with: artil-server account allow ${shellQuoted(accountName)} ${shellQuoted(address)} --channel ${channel}`,
    );
  }

  return {
    find,

    // Who wrote to the account on the channel and was kept out for being on neither its team nor
    // its list, the latest first.
    listKeptOut: ({ accountId, channel }: ListKeptOutOptions) =>
      messagesRepository.listRefusedSenders({ accountId, channel, refusals: [...keptOut] }),

    list: ({ accountId, filter }: ListOptions) =>
      toRecords(messagesRepository.list({ accountId, filter })),

    // Takes a message a channel brought: it wakes the agent of the account the address belongs to
    // when its senders may, and stays in the account's messages either way.
    receive: async ({ channel, message }: ReceiveOptions) => {
      const address = addresses.findByValue({ channel, value: message.to });

      if (
        !address ||
        messagesRepository.hasReceived({ addressId: address.id, externalId: message.externalId })
      ) {
        return;
      }

      const accountId = address.accountId;
      const sender = addresses.findByValue({ channel, value: message.from.address });

      const { refusal, admission } = access.decide({
        accountId,
        channel,
        from: message.from.address,
        handle: message.from.handle,
        fromSelf: sender?.accountId === accountId,
        spam: message.spam ?? false,
        // Another account's address on the server is the team's.
        fromTeam: sender !== undefined,
        fromVerified: message.from.verified,
      });

      // The first time someone the list keeps out writes, the log says how to let them in.
      if (refusal && keptOut.has(refusal)) {
        const counterpart = message.from.address;

        if (!messagesRepository.hasReceivedFrom({ accountId, channel, counterpart })) {
          logKeptOut({ accountId, channel, message });
        }
      }

      const id = crypto.randomUUID();

      // Stored before anything waits, so a message delivered twice at once is taken once.
      messagesRepository.add({
        id,
        accountId,
        addressId: address.id,
        channel,
        direction: "inbound",
        externalId: message.externalId,
        counterpart: message.from.address,
        counterpartName: message.from.name,
        to: [message.to],
        text: message.text,
        status: refusal ? "refused" : "received",
        refusal,
        admission,
      });

      await files.save({ accountId, messageId: id, uploads: message.files });

      if (!refusal) {
        events.add({ accountId, event: { type: "message.received", channel, messageId: id } });
      }
    },

    send,

    // Sends what an agent writes. An answer goes back the way its message came. The channel the
    // server carries itself has no inbox, so a message on it goes whole to the other account; the
    // server keeps one on any other channel.
    async sendDraft({
      accountId,
      accountName,
      client,
      draft,
      uploads,
    }: SendDraftOptions): Promise<Sent> {
      const relayed =
        draft.replyTo === undefined
          ? undefined
          : events.findRelay({ accountId, messageId: draft.replyTo });

      const relayTo = relayed
        ? { to: [relayed.sender.id], toThread: relayed.thread }
        : draft.channel === url.kind
          ? { to: draft.to ?? [], toThread: null }
          : undefined;

      if (!relayTo) {
        return { kind: "stored", message: await send({ accountId, accountName, draft, uploads }) };
      }

      checkCarried(draft, url.kind);

      const event = await url.relay({
        sender: { id: accountId, name: accountName },
        to: relayTo.to,
        text: draft.text,
        thread: null,
        toThread: relayTo.toThread,
        client,
        attachments: draft.attachments ?? [],
        uploads,
      });

      return { kind: "relayed", event, to: relayTo.to };
    },
  };
}

export type MessagesService = ReturnType<typeof createMessagesService>;

export type Receive = MessagesService["receive"];
