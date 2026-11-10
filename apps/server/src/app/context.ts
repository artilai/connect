import type { ChannelDefinition } from "@artil/channels/contract";

import { createChannels } from "../domains/channels/create";
import { loadChannels } from "../domains/channels/load";
import type { Config, Paths } from "../platform/config";
import { openDatabase } from "../platform/db/connection";
import { createS3Store } from "../platform/storage";
import type { Tailscale } from "../platform/tailscale";
import { createServices } from "./services";

type OpenCommandContextOptions = {
  paths: Paths;
  config: Config;
  builtInChannels: readonly ChannelDefinition[];
  migrationsFolder: string;
  tailscale: Tailscale | undefined;
  out: (line: string) => void;
};

// What a command that changes the server works with: the same database the running server uses,
// which picks the change up on its own.
export async function openCommandContext({
  paths,
  config,
  builtInChannels,
  migrationsFolder,
  tailscale,
  out,
}: OpenCommandContextOptions) {
  const database = openDatabase({ path: paths.database, migrationsFolder, secret: config.secret });

  // A command connects addresses; the running server starts them.
  const channels = createChannels({
    definitions: await loadChannels({
      specifiers: config.channels,
      dataDir: paths.dataDir,
      builtInChannels,
    }),
    publicUrl: undefined,
    secret: config.secret,
    log: out,
  });

  const localUrl = `http://localhost:${config.port}`;

  const services = createServices({
    db: database.db,
    secret: config.secret,
    baseUrl: localUrl,
    // Removing an account removes its files from the bucket.
    store: config.s3 ? createS3Store(config.s3) : undefined,
    channels,
    log: out,
  });

  return {
    ...services,
    config,
    paths,
    out,

    // Where agents reach the server, to tell them how to sign in.
    baseUrl: async () => (config.public && tailscale ? tailscale.publicUrl() : localUrl),

    close: () => database.close(),
  };
}

export type CommandContext = Awaited<ReturnType<typeof openCommandContext>>;
