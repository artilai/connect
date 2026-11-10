import { Hono } from "hono";

import { onlyInCloud } from "../../platform/cloud";
import type { AccountEnv } from "../accounts/schema";

// The CLI reads an account's webhooks when it shows its status, so they read as none; changing them
// says that webhooks are only in Artil Cloud.
export function createWebhookRoutes() {
  const webhooks = new Hono<AccountEnv>()
    .get("/", (c) => c.json([]))
    .all("*", () => {
      throw onlyInCloud("Webhooks");
    });

  return new Hono<AccountEnv>().route("/webhooks", webhooks);
}
