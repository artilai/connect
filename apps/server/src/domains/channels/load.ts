import { z } from "zod";

import { type Channel, contractVersion } from "@artil/channels/contract";
import { AppError } from "@artil/errors";
import { channel as urlChannel } from "@artil/url-channel";

import type { ChannelKind } from "./schema";

// A kind names the channel in commands and in the path its provider posts to.
const kindPattern = /^[a-z][a-z0-9\-]*$/v;

// What a channel says of itself: its kind, and the version of the contract it was built for, which
// Channel gives every channel that extends it. A channel from before the contract had versions has
// none, which counts as 0.
const identitySchema = z.looseObject({
  kind: z.string().regex(kindPattern, "A channel's kind is lowercase letters, digits and dashes"),
  contractVersion: z.int().default(0),
});

function invalid(message: string) {
  return new AppError({ code: "invalid_input", message });
}

type ContractMismatchOptions = { kind: string; builtFor: number };

function contractMismatch({ kind, builtFor }: ContractMismatchOptions) {
  const update =
    builtFor < contractVersion
      ? `update the ${kind} channel to one built for version ${contractVersion}`
      : "update artil-connect with: bun add -g @artil-ai/connect";

  return invalid(
    `The ${kind} channel is built for version ${builtFor} of the channel contract, and this server takes version ${contractVersion}; ${update}`,
  );
}

type CheckChannelOptions = { specifier: string; channel: unknown };

// The channel, once it is built for this server's version of the contract.
function checkChannel({ specifier, channel }: CheckChannelOptions) {
  const identity = identitySchema.safeParse(channel);

  if (!identity.success) {
    throw invalid(
      `${specifier} does not export a channel named channel: ${z.prettifyError(identity.error)}`,
    );
  }

  const { kind, contractVersion: builtFor } = identity.data;

  if (builtFor !== contractVersion) throw contractMismatch({ kind, builtFor });

  // SAFETY: only Channel gives a channel this server's version of the contract, so the channel
  // extends Channel of this version, from whichever copy of the package it brought.
  return channel as Channel;
}

type ImportChannelOptions = { specifier: string; dataDir: string };

// A module whose export named channel is a channel, found from the data folder by its path or
// package name, so a package someone installs there resolves.
async function importChannel({ specifier, dataDir }: ImportChannelOptions) {
  let path: string;

  try {
    path = Bun.resolveSync(specifier, dataDir);
  } catch {
    throw invalid(
      `There is no channel ${specifier} from ${dataDir}; give its path, or install its package there`,
    );
  }

  const module: unknown = await import(path);
  const exported = z.object({ channel: z.unknown() }).safeParse(module);

  return checkChannel({ specifier, channel: exported.data?.channel });
}

type LoadChannelsOptions = {
  specifiers: readonly string[];
  dataDir: string;
  // The channels the server comes with, which the config names by their kind.
  builtInChannels: readonly Channel[];
};

// The channels the config names, one of each kind; the Message URL is the server's own, so the
// config cannot load another.
export async function loadChannels({ specifiers, dataDir, builtInChannels }: LoadChannelsOptions) {
  const channels = new Map<ChannelKind, Channel>();

  for (const specifier of specifiers) {
    const builtIn = builtInChannels.find(({ kind }) => kind === specifier);

    const channel = builtIn
      ? checkChannel({ specifier, channel: builtIn })
      : await importChannel({ specifier, dataDir });

    if (channel.kind === urlChannel.kind || channels.has(channel.kind)) {
      throw invalid(
        `The server has a ${channel.kind} channel already; ${specifier} cannot be another`,
      );
    }

    channels.set(channel.kind, channel);
  }

  return channels;
}
