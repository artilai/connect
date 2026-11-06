import { createHmac } from "node:crypto";

import { z } from "zod";

import type { Channel, ChannelContext, ChannelDefinition } from "@artil/channels/contract";

import type { ChannelKind } from "./schema";

type CreateChannelsOptions = {
  definitions: readonly ChannelDefinition[];
  // The server's address on the internet, where providers post; none in local mode.
  publicUrl: string | undefined;
  secret: string;
  log: (line: string) => void;
  // Tests swap it for a fake provider.
  fetch?: ChannelContext["fetch"];
};

// A channel extends the contract's Channel from whichever copy of the package its module brought,
// so the server checks its shape rather than its class.
const channelSchema = z.object({
  kind: z.string(),
  name: z.string(),
  recipients: z.string(),
  senders: z.string(),
  credentials: z.string(),
  disconnect: z.function(),
  start: z.function(),
  readSender: z.function(),
  recipientWritesFirst: z.function(),
  prepare: z.function(),
  send: z.function(),
});

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

      const channelCheck = channelSchema.safeParse(channel);

      if (!channelCheck.success) {
        throw new Error(
          `The ${kind} channel does not extend Channel from @artil/channels: ${z.prettifyError(channelCheck.error)}`,
        );
      }

      if (channel.kind !== kind) {
        throw new Error(`The definition of ${kind} created a ${channel.kind} channel`);
      }

      return [kind, channel];
    }),
  );
}
