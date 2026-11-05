import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { type Channel } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import { admissions, refusals } from "../access/admission";
import type { AgentEnv } from "../agents/env";
import { type ArrivalKind, channelKinds } from "../channels/kinds";
import { onlyInCloud } from "../cloud";
import type { FileLinks } from "../files/links";
import { jsonResponse } from "../http/openapi";
import { readId, validateQuery } from "../http/validate";
import { attachmentSchema, toAttachment } from "./attachments";
import { createDraftReader, sendBodyLimit } from "./draft";
import { type MessageRecord, type MessagesRepository, messageListLimit } from "./repository";
import { channelNames, draftSchema, type Send } from "./send";

const direction = z.enum(["inbound", "outbound"]);

const listSchema = z.object({
  channel: z.enum(channelKinds).exactOptional(),
  direction: direction.exactOptional(),
  limit: z.coerce
    .number()
    .int("Limit must be a whole number")
    .min(1, "Limit must be at least 1")
    .max(messageListLimit, `Limit must be at most ${messageListLimit}`)
    .exactOptional(),
  counterpart: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(320)
    .exactOptional()
    .describe("Keep the messages from or to this address or chat"),
  before: z
    .uuid("before must be a message id")
    .exactOptional()
    .describe("List the messages older than this one, to page back"),
});

const messageSchema = z
  .object({
    id: z.uuid(),
    addressId: z.uuid().describe("The agent's address the message came to or went from"),
    channel: z.enum(channelKinds),
    direction,
    counterpart: z
      .string()
      .describe("Who sent an inbound message, or the recipients of an outbound one"),
    counterpartName: z
      .string()
      .nullable()
      .describe("The name an inbound message's sender goes by, when the channel tells it"),
    to: z.array(z.string()).describe("Whom the message names as its recipients"),
    cc: z.array(z.string()).describe("Whom the message names as getting a copy"),
    subject: z.string().nullable(),
    text: z.string(),
    attachments: z.array(attachmentSchema),
    thread: z
      .object({ messageId: z.string(), references: z.array(z.string()) })
      .nullable()
      .describe("A message's Message-ID and References, on a channel that has them"),
    status: z.enum(["received", "refused", "sending", "sent", "failed"]),
    refusal: z.enum(refusals).nullable().describe("Why a refused message did not wake the agent"),
    admission: z
      .enum(admissions)
      .nullable()
      .describe(
        "Who the sender of a received message is to the agent: `team` for another agent of the server, `listed` for a sender on the channel's list, and `anyone` for everyone else",
      ),
    error: z.string().nullable().describe("Why a failed message was not sent"),
    createdAt: z.date(),
  })
  .meta({ id: "Message" });

type Message = z.infer<typeof messageSchema>;

const tags = ["Messages"];

const docs = {
  list: describeRoute({
    tags,
    operationId: "listMessages",
    summary: "List messages",
    description:
      "List the agent's messages, newest first. To page back, pass the last message's id as before.",
    responses: { 200: jsonResponse("The messages", z.array(messageSchema)) },
  }),
  read: describeRoute({
    tags,
    operationId: "readMessage",
    summary: "Read a message",
    description: "Read a message the agent received or sent.",
    responses: { 200: jsonResponse("The message", messageSchema) },
  }),
  send: describeRoute({
    tags,
    operationId: "sendMessage",
    summary: "Send a message",
    description:
      "Answer a message by giving its id as replyTo, or start a new one with a channel and recipients in to. Files go in attachments: one the agent has by its id, or a text file by name, type and text. To send files from disk, post multipart form data with the message as JSON in draft and one file per file part.",
    responses: { 201: jsonResponse("The sent message", messageSchema) },
  }),
};

const { readDraft, draftForm } = createDraftReader(draftSchema);

type CreateMessageRoutesOptions = {
  messages: MessagesRepository;
  send: Send;
  fileLinks: FileLinks;
  channels: ReadonlyMap<ArrivalKind, Channel<ArrivalKind>>;
};

export function createMessageRoutes({
  messages,
  send,
  fileLinks,
  channels,
}: CreateMessageRoutesOptions) {
  function toMessage({ attachments, ...message }: MessageRecord): Message {
    return {
      ...message,
      attachments: attachments.map((attachment) => toAttachment(attachment, { links: fileLinks })),
    };
  }

  return new Hono<AgentEnv>()
    .get("/", docs.list, validateQuery(listSchema), (c) => {
      const filter = c.req.valid("query");

      if (filter.channel && !channels.has(filter.channel)) {
        throw onlyInCloud(channelNames[filter.channel]);
      }

      return c.json(messages.list({ agentId: c.var.agent.id, filter }).map(toMessage));
    })
    .get("/:messageId", docs.read, (c) => {
      const id = readId(c.req.param("messageId"));
      const message = id && messages.find({ agentId: c.var.agent.id, id });

      if (!message) throw new AppError({ code: "not_found", message: "Message not found" });

      return c.json(toMessage(message));
    })
    .post("/", docs.send, sendBodyLimit, readDraft, draftForm, async (c) => {
      const { draft, files } = c.req.valid("json");
      const { id, name } = c.var.agent;

      const sent = await send({ agentId: id, agentName: name, draft, uploads: files });

      return c.json(toMessage(sent), 201);
    });
}
