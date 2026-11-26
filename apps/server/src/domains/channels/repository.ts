import { and, eq } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { channelState } from "../../platform/db/schema";
import type { ChannelKind } from "./schema";

type ValueOptions = { channel: ChannelKind; key: string };

type SetValueOptions = ValueOptions & { value: string };

// What the server keeps for each channel between its messages.
export function createChannelStateRepository(db: Database) {
  return {
    findValue: ({ channel, key }: ValueOptions) =>
      db
        .select({ value: channelState.value })
        .from(channelState)
        .where(and(eq(channelState.channel, channel), eq(channelState.key, key)))
        .get()?.value ?? null,

    setValue: ({ channel, key, value }: SetValueOptions) =>
      db
        .insert(channelState)
        .values({ channel, key, value })
        .onConflictDoUpdate({ target: [channelState.channel, channelState.key], set: { value } })
        .run(),
  };
}

export type ChannelStateRepository = ReturnType<typeof createChannelStateRepository>;
