#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AppError } from "@artil/errors";

import { version } from "../package.json";
import { runCli } from "./command/cli";
import { SetupStopped } from "./command/setup";
import { createTailscale, findTailscale, runWith } from "./tailscale";

// The migrations sit beside the source in the repo and beside dist in the published package.
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

// Everything the server writes holds its secrets or the agents' messages, so only its owner reads it.
process.umask(0o077);

const binary = findTailscale(process.platform);

try {
  await runCli({
    argv: process.argv.slice(2),
    dataDir: process.env.ARTIL_DATA ?? join(homedir(), ".artil-server"),
    version,
    interactive: process.stdin.isTTY && process.stdout.isTTY,
    migrationsFolder,
    tailscale: binary === undefined ? undefined : createTailscale({ run: runWith(binary) }),
    out: (line) => console.log(line),
  });
} catch (cause) {
  if (!(cause instanceof SetupStopped)) {
    console.error(cause instanceof AppError || cause instanceof TypeError ? cause.message : cause);
  }

  process.exitCode = 1;
}
