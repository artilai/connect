import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { AppError } from "@artil/errors";
import { maxUrlText } from "@artil/url-channel/channel";

import { createDraftReader, sendBodyLimit } from "../../platform/http/draft";
import { jsonResponse } from "../../platform/http/openapi";
import { eventSchema, toEvent } from "../events/schema";
import { attachmentsSchema, type FileLinks } from "../files/schema";
import type { AuthEnv } from "../tokens/schema";
import type { UrlService } from "./service";

const printable = /^[^\p{Cc}\p{Cf}]+$/v;

// A label a client gives, which the server passes on as it is.
function labelSchema(name: string, max: number) {
  return z
    .string()
    .trim()
    .min(1, `${name} cannot be empty`)
    .max(max, `${name} must be at most ${max} characters`)
    .regex(printable, `${name} cannot hold control characters`);
}

// A thread is whatever the client calls its conversation, like a Codex thread id.
const threadSchema = labelSchema("A thread", 128);

const urlMessageSchema = z.object({
  text: z
    .string()
    .trim()
    .max(maxUrlText, `Text must be at most ${maxUrlText} characters`)
    .optional(),
  thread: threadSchema
    .optional()
    .describe("The thread of your client you send from, so the agent can answer there"),
  toThread: threadSchema
    .optional()
    .describe("The thread of the agent's client to hand the message to, from a message it sent"),
  client: labelSchema("A client", 64)
    .optional()
    .describe("The client you send from, like Codex, which the agent sees beside your name"),
  attachments: attachmentsSchema.optional(),
});

const { readDraft, draftForm } = createDraftReader(urlMessageSchema);

const docs = {
  send: describeRoute({
    tags: ["Events"],
    operationId: "sendToAgentUrl",
    summary: "Send to an agent's Message URL",
    description:
      "Send a message to another agent of the server, as the agent whose token you use. The server hands the message whole to whoever listens to the agent, as a message.received event on the url channel. Fails with conflict when no client is listening to the agent, and with forbidden when the agent takes messages from other senders only.",
    responses: { 201: jsonResponse("The message.received event", eventSchema) },
  }),
};

type CreateUrlRoutesOptions = { url: UrlService; fileLinks: FileLinks };

export function createUrlRoutes({ url, fileLinks }: CreateUrlRoutesOptions) {
  return new Hono<AuthEnv>().post(
    "/",
    docs.send,
    sendBodyLimit,
    readDraft,
    draftForm,
    async (c) => {
      const agentId = c.req.param("id")?.toLowerCase();

      if (!agentId) throw new AppError({ code: "not_found", message: "Agent account not found" });

      const { actor } = c.var;
      const { draft, files } = c.req.valid("json");

      const event = await url.relay({
        sender: { id: actor.agentId, name: actor.agentName },
        to: [agentId],
        cc: [],
        text: draft.text ?? "",
        thread: draft.thread ?? null,
        toThread: draft.toThread ?? null,
        // Without a client of its own, the sender goes by whom its token was issued to.
        client: draft.client ?? actor.tokenName,
        attachments: draft.attachments ?? [],
        uploads: files,
      });

      return c.json(toEvent(event, fileLinks), 201);
    },
  );
}
