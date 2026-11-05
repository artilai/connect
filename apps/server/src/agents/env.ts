import { createMiddleware } from "hono/factory";

import { AppError } from "@artil/errors";

import type { AuthEnv } from "../auth/middleware";
import type { AgentRecord, AgentsRepository } from "./repository";

export type AgentEnv = { Variables: AuthEnv["Variables"] & { agent: AgentRecord } };

// An agent's own routes take only its own token.
export function loadAgent(agents: AgentsRepository) {
  return createMiddleware<AgentEnv>(async (c, next) => {
    const id = c.req.param("id")?.toLowerCase();
    const agent = id === c.var.actor.agentId ? agents.findById(id) : undefined;

    if (!agent) throw new AppError({ code: "not_found", message: "Agent account not found" });

    c.set("agent", agent);
    await next();
  });
}
