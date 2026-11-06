import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { jsonResponse } from "../../platform/http/openapi";
import type { AuthEnv } from "../tokens/schema";
import { loadAgent } from "./middleware";
import { agentSchema, toAgent } from "./schema";
import type { AgentsService } from "./service";

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

type CreateAgentRoutesOptions = { agents: AgentsService };

export function createAgentRoutes({ agents }: CreateAgentRoutesOptions) {
  return new Hono<AuthEnv>()
    .get("/", docs.list, (c) => c.json(agents.list().map(toAgent)))
    .get("/:id", docs.read, loadAgent(agents), (c) => c.json(toAgent(c.var.agent)));
}
