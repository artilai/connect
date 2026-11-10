#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AppError } from "@artil/errors";
import { channel as telegramChannel } from "@artil/telegram-channel";

import { version } from "../package.json";
import { runCli } from "./app/cli";
import { runSetup, SetupStopped } from "./app/setup";
import { findArtilCli } from "./platform/artil-cli";
import { createTailscale, findTailscale, runWith } from "./platform/tailscale";

// The migrations sit beside the source in the repo and beside dist in the published package.
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

// Everything the server writes holds its secrets or the accounts' messages, so only its owner reads it.
process.umask(0o077);

const binary = findTailscale(process.platform);

// The server runs until Ctrl-C or the system stops it.
function waitForStop() {
  const { promise, resolve } = Promise.withResolvers<void>();

  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);

  return promise;
}

try {
  await runCli({
    argv: process.argv.slice(2),
    dataDir: process.env.ARTIL_DATA ?? join(homedir(), ".artil-server"),
    version,
    interactive: process.stdin.isTTY && process.stdout.isTTY,
    // The channels the published server comes with, and the one place that names them.
    builtInChannels: [telegramChannel],
    migrationsFolder,
    tailscale: binary === undefined ? undefined : createTailscale({ run: runWith(binary) }),
    artil: findArtilCli(),
    runSetup,
    waitForStop,
    readStdin: () => Bun.stdin.text(),
    out: (line) => console.log(line),
  });
} catch (cause) {
  if (!(cause instanceof SetupStopped)) {
    console.error(cause instanceof AppError || cause instanceof TypeError ? cause.message : cause);
  }

  process.exitCode = 1;
}
