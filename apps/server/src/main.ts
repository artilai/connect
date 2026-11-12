#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { log } from "@clack/prompts";

import { AppError } from "@artil/errors";
import { channel as slackChannel } from "@artil/slack-channel";
import { channel as telegramChannel } from "@artil/telegram-channel";

import { version } from "../package.json";
import { runCli } from "./app/cli";
import { runSetup, SetupStopped } from "./app/setup";
import { findArtilCli } from "./platform/artil-cli";
import { createOut } from "./platform/commands";
import { createTailscale, findTailscale, runWith } from "./platform/tailscale";

// The migrations sit beside the source in the repo and beside dist in the published package.
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

// Everything the server writes holds its secrets or the accounts' messages, so only its owner reads it.
process.umask(0o077);

const binary = findTailscale(process.platform);

// Terminals that show a link under its text, by the names they give themselves; the rest show links
// in full.
const hyperlinkTerminals: ReadonlySet<string> = new Set([
  "iTerm.app",
  "WezTerm",
  "WarpTerminal",
  "ghostty",
  "vscode",
]);

const hyperlinks =
  hyperlinkTerminals.has(process.env.TERM_PROGRAM ?? "") ||
  Boolean(process.env.KITTY_WINDOW_ID ?? process.env.WT_SESSION);

// The server runs until Ctrl-C or the system stops it.
function waitForStop() {
  const { promise, resolve } = Promise.withResolvers<void>();

  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);

  return promise;
}

// A server set up as Artil Server, before 0.5.0, keeps its data in ~/.artil-server until it is moved.
function defaultDataDir() {
  const dataDir = join(homedir(), ".artil-connect");
  const artilServerDataDir = join(homedir(), ".artil-server");

  return existsSync(artilServerDataDir) && !existsSync(dataDir) ? artilServerDataDir : dataDir;
}

try {
  await runCli({
    argv: process.argv.slice(2),
    dataDir: process.env.ARTIL_DATA ?? defaultDataDir(),
    version,
    interactive: process.stdin.isTTY && process.stdout.isTTY,
    // The channels the published server comes with, and the one place that names them.
    builtInChannels: [telegramChannel, slackChannel],
    migrationsFolder,
    tailscale: binary ? createTailscale({ run: runWith(binary) }) : undefined,
    artil: findArtilCli(),
    runSetup,
    waitForStop,
    readStdin: () => Bun.stdin.text(),
    out: createOut({
      terminal: process.stdout.isTTY,
      hyperlinks,
      columns: () => process.stdout.columns,
      write: (text) => console.log(text),
    }),
  });
} catch (cause) {
  if (cause instanceof AppError || cause instanceof TypeError) {
    // A terminal marks what went wrong the way it frames what the commands say.
    if (process.stderr.isTTY) log.error(cause.message, { spacing: 0, output: process.stderr });
    else console.error(cause.message);
  } else if (!(cause instanceof SetupStopped)) {
    console.error(cause);
  }

  process.exitCode = 1;
}
