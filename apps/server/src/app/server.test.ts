import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { newConfig } from "../platform/config";
import { createTailscale } from "../platform/tailscale";
import { startServer } from "./server";
import { findFreePort } from "./testing";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

test("lets go of its port when it fails to start", async () => {
  const port = await findFreePort();

  const start = startServer({
    // Public mode fails once the server has taken its port, on a computer Tailscale is not on.
    config: { ...newConfig({ channels: [] }), port, public: true },
    databasePath: ":memory:",
    migrationsFolder,
    tailscale: createTailscale({
      run: async () => ({ code: 1, stdout: "", stderr: "not running" }),
    }),
    channels: new Map(),
    password: async () => null,
    log: () => {},
  });

  await expect(start).rejects.toThrow("Tailscale could not tell its status: not running");

  const nextServer = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response() });

  await nextServer.stop(true);
});
