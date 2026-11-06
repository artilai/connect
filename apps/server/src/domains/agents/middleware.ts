import { createMiddleware } from "hono/factory";

import { AppError } from "@artil/errors";

import type { AgentEnv } from "./schema";
import type { AgentsService } from "./service";

// An agent's own routes take only its own token.
export function loadAgent(agents: AgentsService) {
  return createMiddleware<AgentEnv>(async (c, next) => {
    const id = c.req.param("id")?.toLowerCase();
    const agent = id === c.var.actor.agentId ? agents.findById(id) : undefined;

    if (!agent) throw new AppError({ code: "not_found", message: "Agent account not found" });

    c.set("agent", agent);
    await next();
  });
}
