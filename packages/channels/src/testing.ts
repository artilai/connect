import type { ChannelState } from "./contract";

// What the server keeps for a channel, in memory, for a channel's tests.
export function createMemoryState(): ChannelState {
  const kept = new Map<string, string>();

  return {
    read: (key) => kept.get(key) ?? null,
    write: (key, value) => {
      kept.set(key, value);
    },
  };
}
