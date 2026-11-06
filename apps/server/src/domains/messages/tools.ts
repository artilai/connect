import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { Channel } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import {
  actingAgentField,
  actingAgentId,
  readOnlyHints,
  type RunTool,
  sendingHints,
  withTitle,
} from "../../platform/mcp";
import { describeRefusal, type Refusal } from "../access/schema";
import type { ChannelsService } from "../channels/service";
import { type RelayRecord, relayedAttachments } from "../events/schema";
import { type FileLinks, toAttachment } from "../files/schema";
import type { Actor } from "../tokens/schema";
import { draftSchema, type MessageRecord } from "./schema";
import type { MessagesService } from "./service";

const listSchema = z.object({
  ...actingAgentField,
  channel: z.string().exactOptional().describe("Keep the messages that came on this channel"),
  limit: z.number().int().min(1).max(25).default(25).describe("How many to list, from 1 to 25"),
  from: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(320)
    .exactOptional()
    .describe("Keep the messages from this address"),
  before: z
    .uuid("before must be a message id")
    .exactOptional()
    .describe("List the messages older than this one; pass the last id listed to page back"),
});

const readSchema = z.object({
  ...actingAgentField,
  id: z
    .uuid("id must be a message id")
    .describe("The message's id, from messages.list or an event"),
});

const draftFields = draftSchema.shape;

type DescribedChannel = Pick<Channel, "kind" | "recipients" | "canCopy">;

// The send tool's input, which tells agents the server's channels and whom each sends to.
function sendSchemaFor(channels: readonly DescribedChannel[]) {
  const copying = channels.flatMap(({ kind, canCopy }) => (canCopy ? [kind] : []));

  return draftSchema.extend({
    ...actingAgentField,
    replyTo: draftFields.replyTo.describe(
      "The id of the message to answer; the answer goes back the way it came. Answer another agent only if its message asks for an answer.",
    ),
    forward: draftFields.forward.describe("Not on this server: forwarding is only in Artil Cloud"),
    channel: z
      .string()
      .optional()
      .describe(
        `The channel to start a conversation on: ${channels.map(({ kind }) => kind).join(" or ")}`,
      ),
    to: draftFields.to.describe(
      `Who to send to: ${channels.map(({ kind, recipients }) => `${kind} takes ${recipients}`).join("; ")}`,
    ),
    cc: draftFields.cc.describe(
      copying.length > 0
        ? `Whom to copy, on ${copying.join(" or ")}`
        : "Not on this server's channels, which copy no one",
    ),
    subject: draftFields.subject.describe("Not on this server's channels, which have no subjects"),
    text: draftFields.text.describe("The message, in plain text"),
    attachments: draftFields.attachments.describe(
      "Files to send: a file from a message the agent received or sent, by the id in its attachments, or a small text file by name, type and text",
    ),
  });
}

function refusalReason(refusal: Refusal | null) {
  return refusal === null ? null : describeRefusal(refusal);
}

function toMessageSummary({
  id,
  channel,
  counterpart,
  counterpartName,
  subject,
  createdAt,
  status,
  refusal,
  admission,
}: MessageRecord) {
  return {
    id,
    channel,
    from: counterpart,
    fromName: counterpartName,
    subject,
    receivedAt: createdAt,
    status,
    refusal,
    reason: refusalReason(refusal),
    admission,
  };
}

function toToolMessage(
  { attachments, direction, counterpart, counterpartName, admission, ...message }: MessageRecord,
  links: FileLinks,
) {
  return {
    id: message.id,
    channel: message.channel,
    direction,
    ...(direction === "inbound" && { from: counterpart, fromName: counterpartName, admission }),
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    text: message.text,
    attachments: attachments.map((attachment) => toAttachment(attachment, { links })),
    createdAt: message.createdAt,
    status: message.status,
    refusal: message.refusal,
    reason: refusalReason(message.refusal),
    error: message.error,
  };
}

type ToRelayedMessageOptions = { sent: RelayRecord; to: string[]; links: FileLinks };

function toRelayedMessage({ sent, to, links }: ToRelayedMessageOptions) {
  const { messageId, channel, text, createdAt } = sent;

  return {
    id: messageId,
    channel,
    direction: "outbound",
    to,
    cc: [],
    text,
    attachments: relayedAttachments(sent, links),
    createdAt,
  };
}

type RegisterMessageToolsOptions = {
  server: McpServer;
  actor: Actor;
  runTool: RunTool;
  messages: MessagesService;
  channels: ChannelsService;
  fileLinks: FileLinks;
};

export function registerMessageTools({
  server,
  actor,
  runTool,
  messages,
  channels,
  fileLinks,
}: RegisterMessageToolsOptions) {
  const sendSchema = sendSchemaFor(channels.list());

  server.registerTool(
    "messages.list",
    {
      ...withTitle("List messages", readOnlyHints),
      description:
        "List the messages the agent account received, newest first. A refused message did not wake the agent, and its reason says why; a received one's admission says whether its sender is on the team, on the channel's list, or anyone else.",
      inputSchema: listSchema,
    },
    ({ agent, from, ...filter }) =>
      runTool(() =>
        messages
          .list({
            agentId: actingAgentId({ agent, signedInAgentId: actor.agentId }),
            filter: {
              ...filter,
              direction: "inbound",
              ...(from !== undefined && { counterpart: from }),
            },
          })
          .map(toMessageSummary),
      ),
  );

  server.registerTool(
    "messages.read",
    {
      ...withTitle("Read a message", readOnlyHints),
      description:
        "Read a message the agent account received or sent, with its text and the files it came with. Each file has a download link that works for 15 minutes with no sign-in; read the message again for a fresh one.",
      inputSchema: readSchema,
    },
    ({ agent, id }) =>
      runTool(() => {
        const message = messages.find({
          agentId: actingAgentId({ agent, signedInAgentId: actor.agentId }),
          id,
        });

        if (!message) throw new AppError({ code: "not_found", message: "Message not found" });

        return toToolMessage(message, fileLinks);
      }),
  );

  server.registerTool(
    "messages.send",
    {
      ...withTitle("Send a message", sendingHints),
      description:
        "Send a message from the agent account. To answer one, give its id in replyTo: the answer goes back the way it came. To start a conversation, give a channel and recipients in to. Files to send go in attachments.",
      inputSchema: sendSchema,
    },
    ({ agent, ...draft }) =>
      runTool(async () => {
        const sent = await messages.sendDraft({
          agentId: actingAgentId({ agent, signedInAgentId: actor.agentId }),
          agentName: actor.agentName,
          client: actor.tokenName,
          draft,
          uploads: [],
        });

        return sent.kind === "stored"
          ? toToolMessage(sent.message, fileLinks)
          : toRelayedMessage({ sent: sent.event, to: sent.to, links: fileLinks });
      }),
  );
}
