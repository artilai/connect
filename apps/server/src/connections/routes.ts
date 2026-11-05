import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import type { AgentEnv } from "../agents/env";
import type { EventsRepository } from "../events/repository";
import { jsonResponse } from "../http/openapi";
import { validateJson } from "../http/validate";
import type { ConnectionRecord, ConnectionsRepository } from "./repository";

const printable = /^[^\p{Cc}\p{Cf}]+$/v;

const connectSchema = z.object({
  client: z
    .string()
    .trim()
    .min(1, "Client cannot be empty")
    .max(80, "Client must be at most 80 characters")
    .regex(printable, "Client cannot hold control characters"),
  machine: z
    .string()
    .trim()
    .min(1, "Machine cannot be empty")
    .max(64, "Machine must be at most 64 characters")
    .regex(printable, "Machine cannot hold control characters")
    .optional(),
});

const connectionSchema = z
  .object({
    id: z.uuid(),
    client: z.string(),
    machine: z.string().nullable(),
    tokenId: z.uuid().meta({ description: "The agent's token the client connected with" }),
  })
  .meta({ id: "Connection" });

type Connection = z.infer<typeof connectionSchema>;

function toConnection({ id, client, machine, tokenId }: ConnectionRecord): Connection {
  return { id, client, machine, tokenId };
}

const tags = ["Connections"];

const docs = {
  read: describeRoute({
    tags,
    operationId: "readConnection",
    summary: "Read an agent's connection",
    description: "The client that hears the agent's new messages, or null before any connects.",
    responses: { 200: jsonResponse("The connection", connectionSchema.nullable()) },
  }),
  connect: describeRoute({
    tags,
    operationId: "connectClient",
    summary: "Connect a client",
    description:
      "Make the calling client the one that hears the agent's new messages, in place of any other. Stream the agent's events with the connection's id to hear them.",
    responses: { 200: jsonResponse("The agent's new connection", connectionSchema) },
  }),
};

type CreateConnectionRoutesOptions = {
  connections: ConnectionsRepository;
  events: EventsRepository;
};

export function createConnectionRoutes({ connections, events }: CreateConnectionRoutesOptions) {
  return new Hono<AgentEnv>()
    .get("/", docs.read, (c) => {
      const connection = connections.findByAgent(c.var.agent.id);

      return c.json(connection ? (toConnection(connection) satisfies Connection) : null);
    })
    .put("/", docs.connect, validateJson(connectSchema), (c) => {
      const { client, machine = null } = c.req.valid("json");
      const agentId = c.var.agent.id;

      const connected = connections.connect({
        agentId,
        tokenHash: c.var.actor.tokenHash,
        client,
        machine,
        lastEventId: events.findLastId(agentId),
      });

      return c.json(toConnection(connected) satisfies Connection);
    });
}
