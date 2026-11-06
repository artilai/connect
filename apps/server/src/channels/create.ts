import { createHmac } from "node:crypto";

import type { Channel, ChannelDefinition } from "@artil/channels/contract";
import type { Fetch } from "@artil/utils/fetch";

import type { ChannelKind } from "./kinds";

type CreateChannelsOptions = {
  definitions: readonly ChannelDefinition[];
  // The server's address on the internet, where providers post; none in local mode.
  publicUrl: string | undefined;
  secret: string;
  log: (line: string) => void;
  // Tests swap it for a fake provider.
  fetch?: Fetch;
};

type ChannelSecretOptions = { secret: string; kind: string };

// Each channel signs with a secret of its own, so none can make what another accepts.
function channelSecret({ secret, kind }: ChannelSecretOptions) {
  return createHmac("sha256", secret).update(`channel:${kind}`).digest("base64url");
}

// Creates the channels the server has from their definitions, each with where its provider posts
// and its secret.
export function createChannels({
  definitions,
  publicUrl,
  secret,
  log,
  fetch = (url, init) => globalThis.fetch(url, init),
}: CreateChannelsOptions) {
  return new Map<ChannelKind, Channel>(
    definitions.map(({ kind, create }) => {
      const channel = create({
        webhookUrl: publicUrl && `${publicUrl}/api/channels/${kind}`,
        secret: channelSecret({ secret, kind }),
        fetch,
        log,
      });

      if (channel.kind !== kind) {
        throw new Error(`The definition of ${kind} created a ${channel.kind} channel`);
      }

      return [kind, channel];
    }),
  );
}
