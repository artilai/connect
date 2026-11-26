import { z } from "zod";

import type { ChannelState } from "@artil/channels/contract";
import { minute } from "@artil/utils/time";

import { readJson } from "./json";

// How often one account's posts wake another at most, in one topic or across new ones, so agents
// cannot keep waking each other: what follows waits on the forum until the window has passed.
const wakeLimit = 5;

const wakeWindow = 10 * minute;

// How many times one account's posts woke another since the count started.
const countSchema = z.object({ wakes: z.int(), since: z.int() });

type CountWakeOptions = { state: ChannelState; from: string; to: string };

// Counts a wake of one account by another's post, and says whether the post may wake it.
export function countWake({ state, from, to }: CountWakeOptions) {
  const key = `wakes:${from}:${to}`;
  const counted = readJson({ state, key, schema: countSchema });
  const now = Date.now();

  // The count starts anew once the window has passed since it started.
  const current = counted && now - counted.since < wakeWindow ? counted : { wakes: 0, since: now };
  const wakes = current.wakes + 1;

  if (wakes > wakeLimit) return false;

  state.write(key, JSON.stringify({ wakes, since: current.since }));

  return true;
}
