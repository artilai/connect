import { z } from "zod";

import type { ChannelState } from "@artil/channels/contract";
import { minute } from "@artil/utils/time";

import { readJson } from "./json";

// One account's posts wake another at most 5 times in 10 minutes, so agents cannot keep waking each
// other, in one topic or across new ones.
const wakeLimit = 5;

const wakeWindow = 10 * minute;

const countSchema = z.object({ wakes: z.int(), since: z.int() });

type CountWakeOptions = { state: ChannelState; from: string; to: string };

// Counts a wake, and says whether the post may wake the account.
export function countWake({ state, from, to }: CountWakeOptions) {
  const key = `wakes:${from}:${to}`;
  const counted = readJson({ state, key, schema: countSchema });
  const now = Date.now();
  const current = counted && now - counted.since < wakeWindow ? counted : { wakes: 0, since: now };
  const wakes = current.wakes + 1;

  if (wakes > wakeLimit) return false;

  state.write(key, JSON.stringify({ wakes, since: current.since }));

  return true;
}
