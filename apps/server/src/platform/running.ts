import { readFile, rename, rm, writeFile } from "node:fs/promises";

import { z } from "zod";

import type { Paths } from "./config";

// Which process serves a data folder and on what port, beside the config, which names the port
// the server takes only from its next start.
const runningSchema = z.object({ pid: z.int(), port: z.int() });

type MarkRunningOptions = { paths: Paths; port: number };

// The note goes in whole or not at all, so artil-connect status never reads half of it.
export async function markRunning({ paths, port }: MarkRunningOptions) {
  const draft = `${paths.running}.${process.pid}.tmp`;

  await writeFile(draft, `${JSON.stringify({ pid: process.pid, port })}\n`, { mode: 0o600 });
  await rename(draft, paths.running);
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

// The note, or nothing for one that is not a note, like an empty file.
function readNote(text: string) {
  try {
    return runningSchema.safeParse(JSON.parse(text)).data;
  } catch {
    return undefined;
  }
}

// The port of the server that serves the data folder, if one does. A server that stopped without
// a word leaves its note behind, with a process that is gone.
export async function findRunningPort(paths: Paths) {
  // A missing note reads as an empty one, which is no note.
  const text = await readFile(paths.running, "utf8").catch(() => "");
  const running = readNote(text);

  return running && isAlive(running.pid) ? running.port : undefined;
}
