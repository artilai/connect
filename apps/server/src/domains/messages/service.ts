import type { InboundMessage } from "@artil/channels/contract";
import { AppError, messageOf } from "@artil/errors";
import type { UrlDelivery } from "@artil/url-channel/channel";
import { shellQuoted } from "@artil/utils/shell";

import { missingChannel, onlyInCloud } from "../../platform/cloud";
import type { Upload } from "../../platform/storage";
import type { AccessService } from "../access/service";
import type { AddressesService } from "../addresses/service";
import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import type { EventsService } from "../events/service";
import type { FileLinks } from "../files/schema";
import type { FilesService } from "../files/service";
import type { UrlService } from "../url/service";
import type { MessageFilter, MessagesRepository } from "./repository";
import type { Draft, MessageRecord, MessageRow } from "./schema";

const recipientSeparator = ", ";

type CreateMessagesServiceOptions = {
  messagesRepository: MessagesRepository;
  files: FilesService;
  fileLinks: FileLinks;
  addresses: AddressesService;
  access: AccessService;
  events: EventsService;
  channels: ChannelsService;
  url: UrlService;
};

type ReceiveOptions = { channel: ChannelKind; message: InboundMessage };

type Recipients = { channel: ChannelKind; to: string[]; cc: string[] };

type SendDraftOptions = {
  agentId: string;
  agentName: string;
  draft: Draft;
  uploads: Upload[];
  // The client the agent writes in, which a message on the Message URL names.
  client: string | null;
};

type SendOptions = Omit<SendDraftOptions, "client"> & { recipients: Recipients };

type ListOptions = { agentId: string; filter: MessageFilter };

type FindOptions = { agentId: string; id: string };

// An answer goes to whoever wrote the message, or to whom the agent wrote it.
function replyRecipients(message: MessageRecord): string[] {
  return message.direction === "inbound" ? [message.counterpart] : message.to;
}

function cannotCopyError(channel: string) {
  return new AppError({ code: "invalid_input", message: `A message on ${channel} copies no one` });
}

export function createMessagesService({
  messagesRepository,
  files,
  fileLinks,
  addresses,
  access,
  events,
  channels,
  url,
}: CreateMessagesServiceOptions) {
  function toRecords(rows: MessageRow[]): MessageRecord[] {
    const attachmentsByMessage = files.describeByMessages(rows.map(({ id }) => id));

    return rows.map(({ agentId: _agentId, externalId: _externalId, ...message }) => ({
      ...message,
      attachments: attachmentsByMessage.get(message.id) ?? [],
    }));
  }

  function find(options: FindOptions) {
    const row = messagesRepository.find(options);

    return row && toRecords([row])[0];
  }

  // An answer goes where its message came from, a new message where the draft says.
  function resolveRecipients(agentId: string, draft: Draft): Recipients {
    if (draft.replyTo === undefined) {
      if (!draft.channel || !draft.to) {
        throw new AppError({
          code: "invalid_input",
          message: "Give replyTo to answer a message, or a channel and recipients in to",
        });
      }

      return { channel: draft.channel, to: draft.to, cc: draft.cc ?? [] };
    }

    const repliedMessage = find({ agentId, id: draft.replyTo });

    if (!repliedMessage) throw new AppError({ code: "not_found", message: "Message not found" });

    return {
      channel: repliedMessage.channel,
      to: draft.to ?? replyRecipients(repliedMessage),
      cc: draft.cc ?? [],
    };
  }

  // An agent's address on the Message URL is its id, which the server gives it by itself.
  function urlAddressOf(agentId: string) {
    return addresses.findOrAdd({ agentId, channel: "url", value: agentId });
  }

  // Sends on a channel with addresses, and keeps the message among the agent's.
  async function send({ agentId, agentName, draft, uploads, recipients }: SendOptions) {
    const { channel: kind, to, cc } = recipients;
    const channel = channels.find(kind);

    if (!channel) throw missingChannel(kind);

    const address = addresses.findByAgent({ agentId, channel: kind });

    if (!address) {
      throw new AppError({
        code: "invalid_input",
        message: `${agentName} has no ${channel.name} address; connect one with: artil-server ${kind} connect ${shellQuoted(agentName)} <credentials>`,
      });
    }

    if (cc.length > 0 && !channel.canCopy) throw cannotCopyError(kind);

    const attachments = await files.readAttachments({
      agentId,
      attachments: draft.attachments ?? [],
    });

    const outgoingFiles = [...attachments, ...uploads];

    if (outgoingFiles.length > 0 && !files.enabled) throw files.unavailableError();

    // Checking the message needs only the files' sizes; their links come once they are saved.
    const prepared = channel.prepare({
      from: address.value,
      fromName: agentName,
      credentials: address.credentials,
      to,
      cc,
      subject: draft.subject ?? null,
      text: draft.text,
      files: outgoingFiles.map((file) => ({ ...file, url: "" })),
      inReplyTo: null,
    });

    for (const recipient of prepared.to) {
      const mustWriteFirst =
        channel.recipientWritesFirst(recipient) &&
        !messagesRepository.hasReceivedFrom({ agentId, channel: kind, counterpart: recipient });

      if (mustWriteFirst) {
        throw new AppError({
          code: "invalid_input",
          message: `${recipient} has to write to ${address.value} before ${agentName} can write to them`,
        });
      }
    }

    const id = crypto.randomUUID();

    messagesRepository.add({
      id,
      agentId,
      addressId: address.id,
      channel: kind,
      direction: "outbound",
      counterpart: prepared.to.join(recipientSeparator),
      to: prepared.to,
      cc: prepared.cc,
      subject: prepared.subject,
      text: prepared.text,
      status: "sending",
    });

    try {
      const savedFiles = await files.save({ agentId, messageId: id, uploads: outgoingFiles });

      const { externalId } = await channel.send({
        ...prepared,
        files: prepared.files.map((file, index) => {
          const fileId = savedFiles[index]?.id;

          return { ...file, url: fileId ? fileLinks.link({ fileId }) : "" };
        }),
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

    const sent = find({ agentId, id });

    if (!sent) throw new Error(`Message ${id} went missing`);

    return sent;
  }

  return {
    find,

    list: ({ agentId, filter }: ListOptions) =>
      toRecords(messagesRepository.list({ agentId, filter })),

    // Takes a message a channel brought: it wakes the agent the address belongs to when its
    // senders may, and stays in the agent's messages either way.
    receive: async ({ channel, message }: ReceiveOptions) => {
      const address = addresses.findByValue({ channel, value: message.to });

      if (
        !address ||
        messagesRepository.hasReceived({ addressId: address.id, externalId: message.externalId })
      ) {
        return;
      }

      const agentId = address.agentId;
      const sender = addresses.findByValue({ channel, value: message.from });

      const { refusal, admission } = access.decide({
        agentId,
        channel,
        from: message.from,
        handle: message.fromHandle,
        fromSelf: sender?.agentId === agentId,
        spam: message.spam,
        // Another agent's address on the server is the team's.
        fromTeam: sender !== undefined,
        fromVerified: message.fromVerified,
      });

      const id = crypto.randomUUID();

      // Stored before anything waits, so a message delivered twice at once is taken once.
      messagesRepository.add({
        id,
        agentId,
        addressId: address.id,
        channel,
        direction: "inbound",
        externalId: message.externalId,
        counterpart: message.from,
        counterpartName: message.fromName,
        to: message.addressees.to,
        cc: message.addressees.cc,
        subject: message.subject,
        text: message.text,
        thread: message.thread,
        status: refusal ? "refused" : "received",
        refusal,
        admission,
      });

      await files.save({ agentId, messageId: id, uploads: message.files });

      if (!refusal) {
        events.add({ agentId, event: { type: "message.received", channel, messageId: id } });
      }
    },

    // Takes a message the Message URL hands over whole: the sender keeps what it sent and the
    // agent it is for what it received, each with the files, and that agent wakes. Both copies
    // name the received one's id, which the event gives.
    async receiveRelay({ from, to, text, files: uploads, thread, toThread, client }: UrlDelivery) {
      if (uploads.length > 0 && !files.enabled) throw files.unavailableError();

      const messageId = crypto.randomUUID();
      const sentId = crypto.randomUUID();

      const copyFields = {
        channel: "url",
        externalId: messageId,
        to: [to.id],
        cc: [],
        subject: null,
        text: text ?? "",
      };

      messagesRepository.add({
        ...copyFields,
        id: sentId,
        agentId: from.id,
        addressId: urlAddressOf(from.id).id,
        direction: "outbound",
        counterpart: to.id,
        status: "sent",
      });

      messagesRepository.add({
        ...copyFields,
        id: messageId,
        agentId: to.id,
        addressId: urlAddressOf(to.id).id,
        direction: "inbound",
        counterpart: from.id,
        counterpartName: from.name,
        status: "received",
        // Only the server's agents write on the Message URL, and its channel let this one in.
        admission: "team",
      });

      // The files go in before the event, so the agent never hears of a message without them.
      await files.save({ agentId: from.id, messageId: sentId, uploads });
      await files.save({ agentId: to.id, messageId, uploads });

      events.add({
        agentId: to.id,
        event: {
          type: "message.received",
          channel: "url",
          messageId,
          text,
          sender: { id: from.id, name: from.name },
          thread,
          toThread,
          client,
        },
      });

      return messageId;
    },

    // Sends what an agent writes, and returns the copy the agent keeps. An answer goes back the
    // way its message came, and one to a message the Message URL brought goes to the thread it
    // came from.
    async sendDraft({
      agentId,
      agentName,
      client,
      draft,
      uploads,
    }: SendDraftOptions): Promise<MessageRecord> {
      if (draft.forward !== undefined) throw onlyInCloud("Forwarding a message");

      const relayed =
        draft.replyTo === undefined
          ? undefined
          : events.findRelay({ agentId, messageId: draft.replyTo });

      const recipients = relayed
        ? { channel: "url", to: [relayed.sender.id], cc: draft.cc ?? [] }
        : resolveRecipients(agentId, draft);

      if (recipients.channel !== "url") {
        return send({ agentId, agentName, draft, uploads, recipients });
      }

      const event = await url.relay({
        sender: { id: agentId, name: agentName },
        to: recipients.to,
        cc: recipients.cc,
        text: draft.text,
        thread: null,
        toThread: relayed?.thread ?? null,
        client,
        attachments: draft.attachments ?? [],
        uploads,
      });

      const row = messagesRepository.findByExternalId({
        agentId,
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

export type ReceiveRelay = MessagesService["receiveRelay"];
