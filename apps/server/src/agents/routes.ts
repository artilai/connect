import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { createAddressRoutes } from "../addresses/routes";
import type { AuthEnv } from "../auth/middleware";
import { createCloudOnlyRoutes } from "../cloud-routes";
import { createConnectionRoutes } from "../connections/routes";
import { createEventRoutes } from "../events/routes";
import { jsonResponse } from "../http/openapi";
import { createMessageRoutes } from "../messages/routes";
import type { Services } from "../services";
import { createUrlRoutes } from "../url/routes";
import { loadAgent } from "./env";
import type { AgentRecord } from "./repository";

const agentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    icon: z.enum(["bot"]),
    secretsEnabled: z.boolean().describe("False: secrets are only in Artil Cloud"),
    createdAt: z.date(),
  })
  .meta({ id: "Agent" });

type Agent = z.infer<typeof agentSchema>;

function toAgent({ id, name, createdAt }: AgentRecord): Agent {
  return { id, name, icon: "bot", secretsEnabled: false, createdAt };
}

const tags = ["Agents"];

const docs = {
  list: describeRoute({
    tags,
    operationId: "listAgents",
    summary: "List agents",
    description: "List the server's agents.",
    responses: { 200: jsonResponse("The agents", z.array(agentSchema)) },
  }),
  read: describeRoute({
    tags,
    operationId: "readAgent",
    summary: "Read an agent",
    responses: { 200: jsonResponse("The agent", agentSchema) },
  }),
};

type CreateAgentRoutesOptions = Pick<
  Services,
  | "agents"
  | "addresses"
  | "connections"
  | "tokens"
  | "events"
  | "messages"
  | "fileLinks"
  | "relay"
  | "send"
  | "channels"
>;

export function createAgentRoutes(services: CreateAgentRoutesOptions) {
  const byId = new Hono<AuthEnv>()
    .use(loadAgent(services.agents))
    .get("/", docs.read, (c) => c.json(toAgent(c.var.agent)))
    .route("/addresses", createAddressRoutes(services))
    .route("/connection", createConnectionRoutes(services))
    .route("/events", createEventRoutes(services))
    .route("/messages", createMessageRoutes(services))
    .route("/", createCloudOnlyRoutes());

  return (
    new Hono<AuthEnv>()
      .get("/", docs.list, (c) => c.json(services.agents.list().map(toAgent)))
      // Any agent of the server writes to another's Message URL.
      .route("/:id/url", createUrlRoutes(services))
      .route("/:id", byId)
  );
}
