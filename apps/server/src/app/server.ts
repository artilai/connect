import { hostname } from "node:os";

import type { ChannelContext, ChannelDefinition } from "@artil/channels/contract";
import { messageOf } from "@artil/errors";
import { hour, second } from "@artil/utils/time";

import { createChannels } from "../domains/channels/create";
import { createReceivers } from "../domains/channels/receivers";
import { createPasswordCheck } from "../domains/sign-in/password";
import type { Config } from "../platform/config";
import { openDatabase } from "../platform/db/connection";
import { createHosts } from "../platform/http/hosts";
import { createS3Store, type FileStore } from "../platform/storage";
import type { Tailscale } from "../platform/tailscale";
import { createApp } from "./http";
import { createServices } from "./services";

function startingResponse() {
  return new Response("Starting", { status: 503 });
}

type StartServerOptions = {
  config: Config;
  databasePath: string;
  migrationsFolder: string;
  // Opens the server to the internet in public mode.
  tailscale: Tailscale | undefined;
  // The channels the config loads, beside the Message URL.
  channels: readonly ChannelDefinition[];
  // Reads the hash of the sign-in page's password for each sign-in, so a new one counts at once.
  password: () => Promise<string | null>;
  log: (line: string) => void;
  // Tests swap these for fakes.
  store?: FileStore | undefined;
  fetch?: ChannelContext["fetch"];
};

// Starts the server: the database, the channels, the HTTP API on the local port, and Funnel in public
// mode. Commands that change the database while it runs show up within a couple of seconds.
export async function startServer({
  config,
  databasePath,
  migrationsFolder,
  tailscale,
  channels: definitions,
  password,
  log,
  store = config.s3 ? createS3Store(config.s3) : undefined,
  fetch,
}: StartServerOptions) {
  const database = openDatabase({ path: databasePath, migrationsFolder });

  // The server takes its port first, so a test can ask for any free one; it answers once ready.
  let handleRequest: (request: Request) => Response | Promise<Response> = startingResponse;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: config.port,
    fetch: (request) => handleRequest(request),
    // An event stream stays open, with a heartbeat every few seconds.
    idleTimeout: 60,
  });

  const port = server.port ?? config.port;

  const publicUrl =
    config.public && tailscale
      ? await tailscale.open(port).catch(async (cause: unknown) => {
          await server.stop(true);
          database.close();

          throw cause;
        })
      : undefined;

  const baseUrl = publicUrl ?? `http://localhost:${port}`;

  const channels = createChannels({
    definitions,
    publicUrl,
    secret: config.secret,
    log,
    ...(fetch && { fetch }),
  });

  const services = createServices({
    db: database.db,
    secret: config.secret,
    baseUrl,
    store,
    channels,
    log,
  });

  const app = createApp({
    services,
    hosts: createHosts({ publicUrl }),
    password: createPasswordCheck({ hash: password }),
    workspace: { id: config.workspaceId, name: hostname(), ownerId: config.ownerId },
    log,
  });

  handleRequest = app.fetch;

  const receivers = channels
    .values()
    .map((channel) =>
      createReceivers({
        channel,
        addresses: services.addresses,
        receive: services.messages.receive,
        log,
      }),
    )
    .toArray();

  function syncReceivers() {
    for (const channelReceivers of receivers) channelReceivers.sync();
  }

  syncReceivers();

  // A command that changes the database changes its data version, and the receivers follow.
  let dataVersion = database.dataVersion();

  const databaseWatcher = setInterval(() => {
    const currentDataVersion = database.dataVersion();

    if (currentDataVersion !== dataVersion) {
      dataVersion = currentDataVersion;
      syncReceivers();
    }
  }, 2 * second);

  function removeExpiredFiles() {
    services.files
      .removeExpired()
      .catch((cause: unknown) =>
        log(`Could not remove expired files: ${messageOf(cause, String(cause))}`),
      );
  }

  // Also at start, so a server that restarts often still removes them.
  removeExpiredFiles();

  const expiredFilesTimer = setInterval(removeExpiredFiles, hour);

  return {
    baseUrl,
    port,
    services,

    async stop() {
      clearInterval(databaseWatcher);
      clearInterval(expiredFilesTimer);

      for (const channelReceivers of receivers) channelReceivers.stop();
      await server.stop(true);

      if (publicUrl) await tailscale?.close();

      database.close();
    },
  };
}
