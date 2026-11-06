import type { Channel } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import type { ChannelKind } from "./schema";

// The server's channels, which the rest of the server reaches by their kind.
export function createChannelsService(channels: ReadonlyMap<ChannelKind, Channel>) {
  return {
    list: () => [...channels.values()],

    find: (kind: ChannelKind) => channels.get(kind),

    // A channel a person names by its kind, as the commands take one.
    get(kind: ChannelKind) {
      const channel = channels.get(kind);

      if (!channel) {
        throw new AppError({
          code: "invalid_input",
          message: `This server has no ${kind} channel; it has ${[...channels.keys()].join(", ")}`,
        });
      }

      return channel;
    },
  };
}

export type ChannelsService = ReturnType<typeof createChannelsService>;
