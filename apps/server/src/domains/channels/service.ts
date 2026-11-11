import { createHmac } from "node:crypto";

import type { Channel, OutboundFile } from "@artil/channels/contract";
import { AppError } from "@artil/errors";
import { formatBytes } from "@artil/utils/text";

import type { ChannelKind } from "./schema";

function invalid(message: string) {
  return new AppError({ code: "invalid_input", message });
}

type CheckLimitsOptions = {
  channel: Channel;
  text: string;
  files: readonly Pick<OutboundFile, "name" | "size">[];
};

// What a message carries, against what its channel takes.
export function checkLimits({ channel, text, files }: CheckLimitsOptions) {
  const { name, limits } = channel;
  const { fileSize } = limits;

  if (text.length > limits.text) {
    throw invalid(`A ${name} message holds at most ${limits.text} characters`);
  }

  if (files.length > limits.files) {
    throw invalid(`A ${name} message carries up to ${limits.files} files`);
  }

  const tooBig = fileSize && files.find(({ size }) => size > fileSize);

  if (tooBig) {
    throw invalid(
      `${tooBig.name} is ${formatBytes(tooBig.size)}; ${name} takes files of up to ${formatBytes(fileSize)}`,
    );
  }
}

type CreateChannelsServiceOptions = {
  channels: ReadonlyMap<ChannelKind, Channel>;
  // The server's address on the internet, where providers post; none in local mode.
  publicUrl?: string;
  secret: string;
};

// The server's channels, which the rest of the server reaches by their kind.
export function createChannelsService({
  channels,
  publicUrl,
  secret,
}: CreateChannelsServiceOptions) {
  return {
    list: () => [...channels.values()],

    find: (kind: ChannelKind) => channels.get(kind),

    // Where the channel's provider posts to the server; none on a computer nothing can reach.
    webhookUrlOf: (kind: ChannelKind) => publicUrl && `${publicUrl}/api/channels/${kind}`,

    // Each channel signs with a secret of its own, so none can make what another accepts.
    webhookSecretOf: (kind: ChannelKind) =>
      createHmac("sha256", secret).update(`channel:${kind}`).digest("base64url"),

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
