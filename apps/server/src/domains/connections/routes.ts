import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { jsonResponse } from "../../platform/http/openapi";
import { validateJson } from "../../platform/http/validate";
import type { AgentEnv } from "../agents/schema";
import { connectionSchema, toConnection } from "./schema";
import type { ConnectionsService } from "./service";

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

type CreateConnectionRoutesOptions = { connections: ConnectionsService };

export function createConnectionRoutes({ connections }: CreateConnectionRoutesOptions) {
  return new Hono<AgentEnv>()
    .get("/", docs.read, (c) => {
      const connection = connections.findByAgent(c.var.agent.id);

      return c.json(connection ? toConnection(connection) : null);
    })
    .put("/", docs.connect, validateJson(connectSchema), (c) => {
      const { client, machine = null } = c.req.valid("json");

      const connected = connections.connect({
        agentId: c.var.agent.id,
        tokenHash: c.var.actor.tokenHash,
        client,
        machine,
      });

      return c.json(toConnection(connected));
    });
}
