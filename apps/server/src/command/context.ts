import type { Channel } from "@artil/channels/contract";
import { createBotApi } from "@artil/telegram-channel/bot-api";
import { createTelegramChannel } from "@artil/telegram-channel/channel";

import type { ChannelKind } from "../channels/kinds";
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
export function openCommandContext({
  paths,
  config,
  migrationsFolder,
  tailscale,
  out,
}: OpenCommandContextOptions) {
  const database = openDatabase({ path: paths.database, migrationsFolder });
  const telegram = createTelegramChannel(createBotApi());
  const channels = new Map<ChannelKind, Channel<ChannelKind>>([["telegram", telegram]]);
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
    telegram,
    config,
    paths,
    out,

    // Where agents reach the server, to tell them how to sign in.
    baseUrl: async () => (config.public && tailscale ? tailscale.publicUrl() : localUrl),

    close: () => database.close(),
  };
}

export type CommandContext = ReturnType<typeof openCommandContext>;
