import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { AppError } from "@artil/errors";

import { jsonResponse } from "../../platform/http/openapi";
import { validateQuery } from "../../platform/http/validate";
import type { AccountEnv } from "../accounts/schema";
import type { ConnectionsService } from "../connections/service";
import type { TokensService } from "../tokens/service";
import { eventSchema } from "./schema";
import type { EventsService } from "./service";
import { streamEvents } from "./stream";

const cursorSchema = z.coerce.number().int("Cursor must be an event id").nonnegative();

const listSchema = z.object({ after: cursorSchema.optional() });

const streamSchema = listSchema.extend({
  connection: z.uuid("Connection must be the id of the agent's connection").optional(),
});

const tags = ["Events"];

const docs = {
  list: describeRoute({
    tags,
    operationId: "listEvents",
    summary: "List events",
    description:
      "Without after, the latest events come newest first. With after, the events that followed it come oldest first.",
    responses: { 200: jsonResponse("The events", z.array(eventSchema)) },
  }),
  stream: describeRoute({
    tags,
    operationId: "streamEvents",
    summary: "Stream events",
    description:
      "Server-sent events, named by type, with each Event as JSON data. A reconnect resumes after Last-Event-ID. With connection, the stream ends once another client connects, and reopening it then fails with conflict.",
    parameters: [{ in: "header", name: "Last-Event-ID", schema: { type: "integer" } }],
    responses: {
      200: {
        description: "The event stream",
        content: { "text/event-stream": { schema: { type: "string" } } },
      },
    },
  }),
};

type CreateEventRoutesOptions = {
  events: EventsService;
  connections: ConnectionsService;
  tokens: TokensService;
};

export function createEventRoutes({ events, connections, tokens }: CreateEventRoutesOptions) {
  return new Hono<AccountEnv>()
    .get("/", docs.list, validateQuery(listSchema), (c) => {
      // Without a cursor the latest events come; the cursor 0 lists them from the first.
      const { after = null } = c.req.valid("query");
      const accountId = c.var.account.id;

      const listedEvents =
        after === null
          ? events.listLatest(accountId)
          : events.listAfter({ accountId, cursor: after });

      return c.json(listedEvents);
    })
    .get("/stream", docs.stream, validateQuery(streamSchema), (c) => {
      const lastEventId = cursorSchema.optional().safeParse(c.req.header("last-event-id"));
      const { after, connection } = c.req.valid("query");
      const accountId = c.var.account.id;

      if (!lastEventId.success) {
        throw new AppError({ code: "invalid_input", message: "Last-Event-ID is not an event id" });
      }

      const resumeAfter = lastEventId.data ?? after;

      if (!connection) {
        const { tokenHash } = c.var.actor;

        return streamEvents({
          c,
          events,
          resumeAfter: resumeAfter ?? events.findLastId(accountId),
          // A stream ends once its token is revoked.
          checkIn: () => tokens.isValid(tokenHash),
        });
      }

      const currentConnection = connections.findByAccount(accountId);

      if (currentConnection?.id !== connection) {
        throw new AppError({
          code: "conflict",
          message: "Another client now hears this agent's new messages",
        });
      }

      // A connection hears what came since it connected, or since the last event it was sent.
      return streamEvents({
        c,
        events,
        resumeAfter: Math.max(resumeAfter ?? 0, currentConnection.startsAfter),
        checkIn: (cursor) => connections.checkIn({ accountId, id: connection, cursor }),
      });
    });
}
