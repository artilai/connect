import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { AppError } from "@artil/errors";

import { createDraftReader, sendBodyLimit } from "../../platform/http/draft";
import { jsonResponse } from "../../platform/http/openapi";
import { eventSchema, toEvent } from "../events/schema";
import type { FileLinks } from "../files/schema";
import type { AuthEnv } from "../tokens/schema";
import { urlMessageSchema } from "./schema";
import type { UrlChannel } from "./service";

const { readDraft, draftForm } = createDraftReader(urlMessageSchema);

const docs = {
  send: describeRoute({
    tags: ["Events"],
    operationId: "sendToAgentUrl",
    summary: "Send to an agent's Message URL",
    description:
      "Send a message to another agent of the server, as the agent whose token you use. The server hands the message whole to whoever listens to the agent, as a message.received event on the url channel, and keeps it among the messages of both agents. Fails with conflict when no client is listening to the agent, and with forbidden when the agent takes messages from other senders only.",
    responses: { 201: jsonResponse("The message.received event", eventSchema) },
  }),
};

type CreateUrlRoutesOptions = { url: UrlChannel; fileLinks: FileLinks };

export function createUrlRoutes({ url, fileLinks }: CreateUrlRoutesOptions) {
  return new Hono<AuthEnv>().post(
    "/",
    docs.send,
    sendBodyLimit,
    readDraft,
    draftForm,
    async (c) => {
      const accountId = c.req.param("id")?.toLowerCase();

      if (!accountId) throw new AppError({ code: "not_found", message: "Agent account not found" });

      const { actor } = c.var;
      const { draft, files } = c.req.valid("json");

      const event = await url.relay({
        from: actor.accountId,
        to: [accountId],
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
