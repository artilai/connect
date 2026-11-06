import { createChannels } from "../channels/create";
import { loadChannels } from "../channels/load";
import type { Config, Paths } from "../config";
import { openDatabase } from "../db/connection";
import { createS3Store } from "../files/store";
import { createServices } from "../services";
import type { Tailscale } from "../tailscale";

type OpenCommandContextOptions = {
  paths: Paths;
  config: Config;
  migrationsFolder: string;
  tailscale: Tailscale | undefined;
  out: (line: string) => void;
};

// What a command that changes the server works with: the same database the running server uses,
// which picks the change up on its own.
export async function openCommandContext({
  paths,
  config,
  migrationsFolder,
  tailscale,
  out,
}: OpenCommandContextOptions) {
  const database = openDatabase({ path: paths.database, migrationsFolder });

  // A command connects addresses; the running server starts them.
  const channels = createChannels({
    definitions: await loadChannels({ specifiers: config.channels, dataDir: paths.dataDir }),
    publicUrl: undefined,
    secret: config.secret,
    log: out,
  });

  const localUrl = `http://localhost:${config.port}`;

  const services = createServices({
    db: database.db,
    secret: config.secret,
    baseUrl: localUrl,
    // Removing an agent removes its files from the bucket.
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
