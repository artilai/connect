import type { ChannelState } from "./contract";

export function createMemoryState(): ChannelState {
  const kept = new Map<string, string>();

  return {
    read: (key) => kept.get(key) ?? null,
    write: (key, value) => {
      kept.set(key, value);
    },
  };
}
