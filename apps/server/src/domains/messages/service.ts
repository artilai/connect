import type { InboundMessage } from "@artil/channels/contract";
import { AppError, messageOf } from "@artil/errors";
import { shellQuoted } from "@artil/utils/shell";

import { missingChannel, onlyInCloud } from "../../platform/cloud";
import type { Upload } from "../../platform/storage";
import type { Refusal } from "../access/schema";
import type { AccessService } from "../access/service";
import type { AccountsService } from "../accounts/service";
import type { ConnectedAddress } from "../addresses/schema";
import type { AddressesService } from "../addresses/service";
import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import type { EventsService } from "../events/service";
import type { FilesService } from "../files/service";
import type { UrlDelivery } from "../url/schema";
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

type Recipients = {
  channel: ChannelKind;
  to: string[];
  replyTo?: string;
};

type SendDraftOptions = {
  accountId: string;
  accountName: string;
  draft: Draft;
  uploads: Upload[];
  // The client the agent writes in, which a message on the Message URL names.
  client: string | null;
};

type SendOptions = Omit<SendDraftOptions, "client"> & { recipients: Recipients };

type ListOptions = { accountId: string; filter: MessageFilter };

type FindOptions = { accountId: string; id: string };

// Whom an answer on the Message URL goes to, and the thread of their client it goes to.
type UrlAnswer = { to: string[]; toThread: string | null };

// An answer goes to whoever wrote the message, or to whom the agent wrote it.
function replyRecipients(message: MessageRow): string[] {
  return message.direction === "inbound" ? [message.counterpart] : message.to;
}

// What no channel of this server carries: forwarding, copies and subjects are email's, in Artil
// Cloud.
function checkCarried(draft: Draft, kind: ChannelKind) {
  if (draft.forward) throw onlyInCloud("Forwarding a message");

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
    if (!draft.replyTo) {
      if (!draft.channel || !draft.to) {
        throw new AppError({
          code: "invalid_input",
          message: "Give replyTo to answer a message, or a channel and recipients in to",
        });
      }

      return { channel: draft.channel, to: draft.to };
    }

    const repliedMessage = messagesRepository.find({ accountId, id: draft.replyTo });

    if (!repliedMessage) throw new AppError({ code: "not_found", message: "Message not found" });

    return {
      channel: repliedMessage.channel,
      to: draft.to ?? replyRecipients(repliedMessage),
      // The channel threads the answer by its own id for the message, when it gave one.
      ...(repliedMessage.externalId !== null && { replyTo: repliedMessage.externalId }),
    };
  }

  // An account's address on the Message URL is its id, which the server gives it by itself.
  function urlAddressOf(accountId: string) {
    return addresses.findOrAdd({ accountId, channel: url.kind, value: accountId });
  }

  // An answer to a message on the Message URL goes to whoever sent one the account received, in
  // the thread it came from, or again to whom the account sent one, in the thread it went to. The
  // event the receiving account got tells the threads, which the messages do not keep.
  function findUrlAnswer({ accountId, id }: FindOptions): UrlAnswer | undefined {
    const receivedEvent = events.findRelay({ accountId, messageId: id });

    if (receivedEvent) return { to: [receivedEvent.sender.id], toThread: receivedEvent.thread };

    const sent = messagesRepository.find({ accountId, id });
    const [recipientId] = sent?.to ?? [];

    if (sent?.channel !== url.kind || sent.direction !== "outbound") return undefined;

    // Both copies hold the id of the received one, which its event goes by.
    const recipientEvent =
      recipientId && sent.externalId
        ? events.findRelay({ accountId: recipientId, messageId: sent.externalId })
        : undefined;

    return { to: sent.to, toThread: recipientEvent?.toThread ?? null };
  }

  // Sends on a channel with addresses, and keeps the message among the account's.
  async function send({ accountId, accountName, draft, uploads, recipients }: SendOptions) {
    const { channel: kind, ...addressed } = recipients;
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
      from: address.value,
      ...addressed,
      text: draft.text,
      files: outgoingFiles,
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

      const { id: externalId } = await channel.send({
        message: prepared,
        credentials: address.credentials,
      });

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

  // Lets them in by their address, which stays theirs, where a username can pass to someone
  // else; in a group, everyone in it by the group's.
  function logKeptOut({ accountId, channel, message }: LogKeptOutOptions) {
    const accountName = accounts.findById(accountId)?.name ?? accountId;
    const channelName = channels.find(channel)?.name ?? channel;
    const { from, group } = message;
    const goesBy = from.username ?? from.address;
    const named = from.name ? `${from.name} (${goesBy})` : goesBy;

    // A sender that starts with a dash, like a group's id, reads as no flag only after --.
    function allowCommand(sender: string) {
      const allow = `artil-server account allow ${shellQuoted(accountName)}`;

      return sender.startsWith("-")
        ? `${allow} --channel ${channel} -- ${shellQuoted(sender)}`
        : `${allow} ${shellQuoted(sender)} --channel ${channel}`;
    }

    log(
      group
        ? `${named} wrote to ${accountName} in ${group.name ?? group.address} on ${channelName} but neither is on its list; let them in with: ${allowCommand(from.address)}, or everyone in the group with: ${allowCommand(group.address)}`
        : `${named} wrote to ${accountName} on ${channelName} but is not on its list; let them in with: ${allowCommand(from.address)}`,
    );
  }

  type ReceiveAtOptions = ReceiveOptions & { address: ConnectedAddress };

  async function receiveAt({ channel, message, address }: ReceiveAtOptions) {
    if (messagesRepository.hasReceived({ addressId: address.id, externalId: message.id })) return;

    const accountId = address.accountId;
    const { from, group } = message;
    const sender = addresses.findByValue({ channel, value: from.address });

    // A message in a group is the group's, which an answer goes to, and names who wrote it.
    const counterpart = group?.address ?? from.address;

    const { refusal, admission } = access.decide({
      accountId,
      channel,
      from: from.address,
      username: from.username,
      group: group?.address ?? null,
      fromSelf: sender?.accountId === accountId,
      // Another account's address on the server is the team's.
      fromTeam: Boolean(sender),
      fromVerified: from.verified,
    });

    // The first time someone the list keeps out writes, or a group, the log says how to let
    // them in.
    if (
      refusal &&
      keptOut.has(refusal) &&
      !messagesRepository.hasReceivedFrom({ accountId, channel, counterpart })
    ) {
      logKeptOut({ accountId, channel, message });
    }

    const id = crypto.randomUUID();

    // Stored before anything waits, so a message delivered twice at once is taken once.
    messagesRepository.add({
      id,
      accountId,
      addressId: address.id,
      channel,
      direction: "inbound",
      externalId: message.id,
      counterpart,
      counterpartName: group ? group.name : from.name,
      author: group ? from.address : null,
      authorName: group ? from.name : null,
      to: message.to,
      text: message.text,
      status: refusal ? "refused" : "received",
      refusal,
      admission,
    });

    await files.save({ accountId, messageId: id, uploads: message.files });

    if (!refusal) {
      events.add({ accountId, event: { type: "message.received", channel, messageId: id } });
    }
  }

  return {
    find,

    // Who wrote to the account on the channel and was kept out for being on neither its team nor
    // its list, the latest first.
    listKeptOut: ({ accountId, channel }: ListKeptOutOptions) =>
      messagesRepository.listRefusedSenders({ accountId, channel, refusals: [...keptOut] }),

    list: ({ accountId, filter }: ListOptions) =>
      toRecords(messagesRepository.list({ accountId, filter })),

    // Takes a message a channel brought to the addresses it went to: it wakes the agent of each
    // account one of them belongs to when its senders may, and stays in the account's messages
    // either way.
    receive: async ({ channel, message }: ReceiveOptions) => {
      for (const value of message.to) {
        const address = addresses.findByValue({ channel, value });

        if (address) await receiveAt({ channel, message, address });
      }
    },

    // Takes a message the Message URL hands over whole: the sender keeps what it sent and the
    // account it is for what it received, each with the files, and that account wakes. The
    // sender's copy is sent once the event is, and both copies then name the received one's id,
    // which the event gives.
    async receiveRelay({ from, to, text, files: uploads, thread, toThread, client }: UrlDelivery) {
      const messageId = crypto.randomUUID();
      const sentId = crypto.randomUUID();

      messagesRepository.add({
        id: sentId,
        accountId: from.id,
        addressId: urlAddressOf(from.id).id,
        channel: url.kind,
        direction: "outbound",
        counterpart: to,
        to: [to],
        text,
        status: "sending",
      });

      try {
        messagesRepository.add({
          id: messageId,
          accountId: to,
          addressId: urlAddressOf(to).id,
          channel: url.kind,
          direction: "inbound",
          externalId: messageId,
          counterpart: from.id,
          counterpartName: from.name,
          to: [to],
          text,
          status: "received",
          // Only the server's accounts write on the Message URL, and its channel let this one in.
          admission: "team",
        });

        // The files go in before the event, so the agent never hears of a message without them.
        await files.save({ accountId: from.id, messageId: sentId, uploads });
        await files.save({ accountId: to, messageId, uploads });

        const event = events.relay({
          accountId: to,
          event: {
            type: "message.received",
            channel: url.kind,
            messageId,
            text: text || null,
            sender: { id: from.id, name: from.name },
            thread,
            toThread,
            client,
          },
        });

        messagesRepository.markSent(sentId, messageId);

        return event;
      } catch (cause) {
        messagesRepository.markFailed(sentId, messageOf(cause, "the server gave no reason"));

        throw cause;
      }
    },

    // Sends what an agent writes, and returns the copy the account keeps. An answer goes back the
    // way its message came, and on the Message URL to the thread it came from or went to.
    async sendDraft({
      accountId,
      accountName,
      client,
      draft,
      uploads,
    }: SendDraftOptions): Promise<MessageRecord> {
      const urlAnswer = draft.replyTo ? findUrlAnswer({ accountId, id: draft.replyTo }) : undefined;

      const recipients = urlAnswer
        ? { channel: url.kind, to: urlAnswer.to }
        : resolveRecipients(accountId, draft);

      checkCarried(draft, recipients.channel);

      if (recipients.channel !== url.kind) {
        return send({ accountId, accountName, draft, uploads, recipients });
      }

      const event = await url.relay({
        from: accountId,
        to: recipients.to,
        text: draft.text,
        thread: null,
        toThread: urlAnswer?.toThread ?? null,
        client,
        attachments: draft.attachments ?? [],
        uploads,
      });

      const row = messagesRepository.findByExternalId({
        accountId,
        direction: "outbound",
        externalId: event.messageId,
      });

      const [sent] = row ? toRecords([row]) : [];

      if (!sent) throw new Error(`Message ${event.messageId} went missing`);

      return sent;
    },
  };
}

export type MessagesService = ReturnType<typeof createMessagesService>;

export type Receive = MessagesService["receive"];
