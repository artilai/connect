import { z } from "zod";

import { type Channel, type OutboundMessage } from "@artil/channels/contract";
import { AppError, messageOf } from "@artil/errors";
import { shellQuoted } from "@artil/utils/shell";

import type { AddressesRepository } from "../addresses/repository";
import { apiChannelKinds, type ChannelKind } from "../channels/kinds";
import { missingChannel, onlyInCloud } from "../cloud";
import type { FileLinks } from "../files/links";
import { attachmentsSchema, readAttachments } from "../files/outgoing";
import type { FilesService, Upload } from "../files/service";
import type { MessageRecord, MessagesRepository } from "./repository";

const maxRecipients = 10;

const maxText = 32_000;

export const draftSchema = z.object({
  replyTo: z.uuid("replyTo must be a message id").optional(),
  forward: z.uuid("forward must be a message id").optional(),
  channel: z.enum(apiChannelKinds).optional(),
  to: z
    .array(z.string().trim().min(1).max(320))
    .min(1, "Give at least one recipient")
    .max(maxRecipients, `Send to at most ${maxRecipients} recipients`)
    .optional(),
  cc: z.array(z.string().trim().min(1).max(320)).max(50, "Copy at most 50 addresses").optional(),
  subject: z.string().trim().max(240, "Subject must be at most 240 characters").optional(),
  text: z.string().min(1, "Text cannot be empty").max(maxText, "Text is too long"),
  attachments: attachmentsSchema.optional(),
});

// What the API's requests take; MCP sends on any channel of the server.
export type Draft = Omit<z.infer<typeof draftSchema>, "channel"> & {
  channel?: ChannelKind | undefined;
};

const recipientSeparator = ", ";

type CreateSenderOptions = {
  addresses: AddressesRepository;
  messages: MessagesRepository;
  files: FilesService;
  fileLinks: FileLinks;
  channels: ReadonlyMap<ChannelKind, Channel>;
};

type SendOptions = { agentId: string; agentName: string; draft: Draft; uploads: Upload[] };

type Recipients = { channel: ChannelKind; to: string[]; cc: string[] };

// An answer goes to whoever wrote the message, or to whom the agent wrote it.
function replyRecipients(message: MessageRecord): string[] {
  return message.direction === "inbound" ? [message.counterpart] : message.to;
}

function leaveUnchanged(message: OutboundMessage) {
  return message;
}

function cannotCopyError(channel: string) {
  return new AppError({ code: "invalid_input", message: `A message on ${channel} copies no one` });
}

export function createSender({
  addresses,
  messages,
  files,
  fileLinks,
  channels,
}: CreateSenderOptions) {
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

    const repliedMessage = messages.find({ agentId, id: draft.replyTo });

    if (!repliedMessage) throw new AppError({ code: "not_found", message: "Message not found" });

    return {
      channel: repliedMessage.channel,
      to: draft.to ?? replyRecipients(repliedMessage),
      cc: draft.cc ?? [],
    };
  }

  return async function send({ agentId, agentName, draft, uploads }: SendOptions) {
    if (draft.forward !== undefined) throw onlyInCloud("Forwarding a message");

    const { channel: kind, to, cc } = resolveRecipients(agentId, draft);
    const channel = channels.get(kind);

    if (!channel) throw missingChannel(kind);

    const address = addresses.findByAgent({ agentId, channel: kind });

    if (!address) {
      throw new AppError({
        code: "invalid_input",
        message: `${agentName} has no ${channel.name} address; connect one with: artil-server ${kind} connect ${shellQuoted(agentName)} <credentials>`,
      });
    }

    if (cc.length > 0 && !channel.canCopy) throw cannotCopyError(kind);

    const attachments = await readAttachments({
      files,
      agentId,
      attachments: draft.attachments ?? [],
    });

    const outgoingFiles = [...attachments, ...uploads];

    if (outgoingFiles.length > 0 && !files.enabled) throw files.unavailableError();

    // Checking the message needs only the files' sizes; their links come once they are saved.
    const prepared = (channel.prepare ?? leaveUnchanged)({
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
        channel.recipientWritesFirst?.(recipient) &&
        !messages.hasReceivedFrom({ agentId, channel: kind, counterpart: recipient });

      if (mustWriteFirst) {
        throw new AppError({
          code: "invalid_input",
          message: `${recipient} has to write to ${address.value} before ${agentName} can write to them`,
        });
      }
    }

    const id = crypto.randomUUID();

    messages.add({
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

      messages.markSent(id, externalId);
    } catch (cause) {
      const reason = messageOf(cause, "the provider gave no reason");

      messages.markFailed(id, reason);

      throw cause instanceof AppError
        ? cause
        : new AppError({
            code: "unavailable",
            message: `${channel.name} did not take the message: ${reason}`,
            cause,
          });
    }

    const sent = messages.find({ agentId, id });

    if (!sent) throw new Error(`Message ${id} went missing`);

    return sent;
  };
}

export type Send = ReturnType<typeof createSender>;
