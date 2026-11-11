import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { AppError } from "@artil/errors";

import { missingChannel } from "../../platform/cloud";
import { createDraftReader, sendBodyLimit } from "../../platform/http/draft";
import { jsonResponse } from "../../platform/http/openapi";
import { readId, validateQuery } from "../../platform/http/validate";
import type { AgentEnv } from "../agents/schema";
import { apiChannelKinds } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import type { FileLinks } from "../files/schema";
import { directionSchema, draftSchema, messageListLimit, messageSchema, toMessage } from "./schema";
import type { MessagesService } from "./service";

const listSchema = z.object({
  channel: z.enum(apiChannelKinds).exactOptional(),
  direction: directionSchema.exactOptional(),
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
  messages: MessagesService;
  channels: ChannelsService;
  fileLinks: FileLinks;
};

export function createMessageRoutes({ messages, channels, fileLinks }: CreateMessageRoutesOptions) {
  return new Hono<AgentEnv>()
    .get("/", docs.list, validateQuery(listSchema), (c) => {
      const filter = c.req.valid("query");

      if (filter.channel && !channels.find(filter.channel)) throw missingChannel(filter.channel);

      return c.json(
        messages
          .list({ agentId: c.var.agent.id, filter })
          .map((message) => toMessage(message, fileLinks)),
      );
    })
    .get("/:messageId", docs.read, (c) => {
      const id = readId(c.req.param("messageId"));
      const message = id && messages.find({ agentId: c.var.agent.id, id });

      if (!message) throw new AppError({ code: "not_found", message: "Message not found" });

      return c.json(toMessage(message, fileLinks));
    })
    .post("/", docs.send, sendBodyLimit, readDraft, draftForm, async (c) => {
      const { draft, files } = c.req.valid("json");
      const { id, name } = c.var.agent;

      const sent = await messages.sendDraft({
        agentId: id,
        agentName: name,
        client: c.var.actor.tokenName,
        draft,
        uploads: files,
      });

      return c.json(toMessage(sent, fileLinks), 201);
    });
}
