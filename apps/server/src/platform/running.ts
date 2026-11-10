import { readFile, rm, writeFile } from "node:fs/promises";

import { z } from "zod";

import type { Paths } from "./config";

// Which process serves a data folder and on what port, beside the config, which names the port
// the server takes only from its next start.
const runningSchema = z.object({ pid: z.int(), port: z.int() });

type MarkRunningOptions = { paths: Paths; port: number };

export async function markRunning({ paths, port }: MarkRunningOptions) {
  await writeFile(paths.running, `${JSON.stringify({ pid: process.pid, port })}\n`, {
    mode: 0o600,
  });
}

export async function unmarkRunning(paths: Paths) {
  await rm(paths.running, { force: true });
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

// The port of the server that serves the data folder, if one does. A server that stopped without
// a word leaves its note behind, with a process that is gone.
export async function findRunningPort(paths: Paths) {
  const text = await readFile(paths.running, "utf8").catch(() => undefined);

  if (text === undefined) return undefined;

  const running = runningSchema.safeParse(JSON.parse(text)).data;

  return running && isAlive(running.pid) ? running.port : undefined;
}
