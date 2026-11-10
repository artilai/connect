import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { newConfig } from "../platform/config";
import { startServer } from "./server";
import { findFreePort } from "./testing";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

test("lets go of its port when it fails to start", async () => {
  const port = await findFreePort();

  const start = startServer({
    config: { ...newConfig({ channels: [] }), port },
    databasePath: ":memory:",
    migrationsFolder,
    tailscale: undefined,
    // A channel of someone's own that fails once the server has taken its port.
    channels: [
      {
        kind: "broken",
        create: () => {
          throw new Error("The broken channel does not start");
        },
      },
    ],
    password: async () => null,
    log: () => {},
  });

  await expect(start).rejects.toThrow("The broken channel does not start");

  const nextServer = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response() });

  await nextServer.stop(true);
});
