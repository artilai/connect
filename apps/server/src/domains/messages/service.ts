import type { InboundMessage } from "@artil/channels/contract";
import { AppError, messageOf } from "@artil/errors";
import { shellQuoted } from "@artil/utils/shell";

import { missingChannel, onlyInCloud } from "../../platform/cloud";
import type { Upload } from "../../platform/storage";
import type { AccessService } from "../access/service";
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

type CreateMessagesServiceOptions = {
  messagesRepository: MessagesRepository;
  files: FilesService;
  addresses: AddressesService;
  access: AccessService;
  events: EventsService;
  channels: ChannelsService;
  url: UrlChannel;
};

type ReceiveOptions = { channel: ChannelKind; message: InboundMessage };

type SendOptions = { agentId: string; agentName: string; draft: Draft; uploads: Upload[] };

type SendDraftOptions = SendOptions & {
  // The client the agent writes in, which a relayed message names.
  client: string | null;
};

type ListOptions = { agentId: string; filter: MessageFilter };

type FindOptions = { agentId: string; id: string };

type Recipients = {
  channel: ChannelKind;
  to: string[];
  inReplyTo: { externalId: string } | null;
};

// What came of a message an agent wrote: the server keeps one in the agent's inbox, and relays one
// on a channel without an inbox whole to the other agent.
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
  files,
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

      return { channel: draft.channel, to: draft.to, inReplyTo: null };
    }

    const repliedMessage = messagesRepository.find({ agentId, id: draft.replyTo });

    if (!repliedMessage) throw new AppError({ code: "not_found", message: "Message not found" });

    return {
      channel: repliedMessage.channel,
      to: draft.to ?? replyRecipients(repliedMessage),
      // The channel threads the answer by its own id for the message, when it gave one.
      inReplyTo:
        repliedMessage.externalId === null ? null : { externalId: repliedMessage.externalId },
    };
  }

  // Sends on a channel with addresses, and keeps the message among the agent's.
  async function send({ agentId, agentName, draft, uploads }: SendOptions) {
    const { channel: kind, to, inReplyTo } = resolveRecipients(agentId, draft);

    checkCarried(draft, kind);

    const channel = channels.find(kind);

    if (!channel) throw missingChannel(kind);

    const address = addresses.findByAgent({ agentId, channel: kind });

    if (!address) {
      throw new AppError({
        code: "invalid_input",
        message: `${agentName} has no ${channel.name} address; connect one with: artil-server account connect ${shellQuoted(agentName)} ${kind}`,
      });
    }

    const attachments = await files.readAttachments({
      agentId,
      attachments: draft.attachments ?? [],
    });

    const outgoingFiles = [...attachments, ...uploads];

    if (outgoingFiles.length > 0 && !files.enabled) throw files.unavailableError();

    const prepared = channel.prepare({
      from: { address: address.value, name: agentName, credentials: address.credentials },
      to,
      text: draft.text,
      files: outgoingFiles,
      inReplyTo,
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
      text: prepared.text,
      status: "sending",
    });

    try {
      await files.save({ agentId, messageId: id, uploads: outgoingFiles });

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
      const sender = addresses.findByValue({ channel, value: message.from.address });

      const { refusal, admission } = access.decide({
        agentId,
        channel,
        from: message.from.address,
        handle: message.from.handle,
        fromSelf: sender?.agentId === agentId,
        spam: message.spam ?? false,
        // Another agent's address on the server is the team's.
        fromTeam: sender !== undefined,
        fromVerified: message.from.verified,
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
        counterpart: message.from.address,
        counterpartName: message.from.name,
        to: [message.to],
        text: message.text,
        status: refusal ? "refused" : "received",
        refusal,
        admission,
      });

      await files.save({ agentId, messageId: id, uploads: message.files });

      if (!refusal) {
        events.add({ agentId, event: { type: "message.received", channel, messageId: id } });
      }
    },

    send,

    // Sends what an agent writes. An answer goes back the way its message came. The channel the
    // server carries itself has no inbox, so a message on it goes whole to the other agent; the
    // server keeps one on any other channel.
    async sendDraft({
      agentId,
      agentName,
      client,
      draft,
      uploads,
    }: SendDraftOptions): Promise<Sent> {
      const relayed =
        draft.replyTo === undefined
          ? undefined
          : events.findRelay({ agentId, messageId: draft.replyTo });

      const relayTo = relayed
        ? { to: [relayed.sender.id], toThread: relayed.thread }
        : draft.channel === url.kind
          ? { to: draft.to ?? [], toThread: null }
          : undefined;

      if (!relayTo) {
        return { kind: "stored", message: await send({ agentId, agentName, draft, uploads }) };
      }

      checkCarried(draft, url.kind);

      const event = await url.relay({
        sender: { id: agentId, name: agentName },
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
