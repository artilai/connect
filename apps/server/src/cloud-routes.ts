import { Hono } from "hono";

import type { AgentEnv } from "./agents/env";
import { onlyInCloud } from "./cloud";

// The CLI reads an agent's secrets and webhooks when it shows its status, so they read as none;
// the rest of what only Artil Cloud does says so.
export function createCloudOnlyRoutes() {
  const secrets = new Hono<AgentEnv>()
    .get("/", (c) => c.json([]))
    .all("*", () => {
      throw onlyInCloud("Secrets");
    });

  const webhooks = new Hono<AgentEnv>()
    .get("/", (c) => c.json([]))
    .all("*", () => {
      throw onlyInCloud("Webhooks");
    });

  return new Hono<AgentEnv>().route("/secrets", secrets).route("/webhooks", webhooks);
}
