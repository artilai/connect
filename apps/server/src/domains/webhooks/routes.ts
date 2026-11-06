import { Hono } from "hono";

import { onlyInCloud } from "../../platform/cloud";
import type { AgentEnv } from "../agents/schema";

// The CLI reads an agent's webhooks when it shows its status, so they read as none; changing them
// says that webhooks are only in Artil Cloud.
export function createWebhookRoutes() {
  const webhooks = new Hono<AgentEnv>()
    .get("/", (c) => c.json([]))
    .all("*", () => {
      throw onlyInCloud("Webhooks");
    });

  return new Hono<AgentEnv>().route("/webhooks", webhooks);
}
