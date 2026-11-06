import { z } from "zod";

import type { Channel, ChannelContext, ChannelDefinition } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import { urlKind } from "../url/schema";

// A kind names the channel in commands and in the path its provider posts to.
const kindPattern = /^[a-z][a-z0-9\-]*$/v;

const definitionSchema = z.object({
  kind: z.string().regex(kindPattern, "A channel's kind is lowercase letters, digits and dashes"),
  // A function the server calls with its context; createChannels checks the channel it returns.
  create: z.function({ input: [z.custom<ChannelContext>()], output: z.custom<Channel>() }),
});

type ImportChannelOptions = { specifier: string; dataDir: string };

// A module whose export named channel defines a channel, found from the data folder by its path or
// package name, so a package someone installs there resolves.
async function importChannel({ specifier, dataDir }: ImportChannelOptions) {
  let path: string;

  try {
    path = Bun.resolveSync(specifier, dataDir);
  } catch {
    throw new AppError({
      code: "invalid_input",
      message: `There is no channel ${specifier} from ${dataDir}; give its path, or install its package there`,
    });
  }

  const module: unknown = await import(path);
  const definition = z.object({ channel: definitionSchema }).safeParse(module);

  if (!definition.success) {
    throw new AppError({
      code: "invalid_input",
      message: `${specifier} does not export a channel definition named channel: ${z.prettifyError(definition.error)}`,
    });
  }

  return definition.data.channel;
}

type LoadChannelsOptions = {
  specifiers: readonly string[];
  dataDir: string;
  // The channels the server comes with, which the config names by their kind.
  builtInChannels: readonly ChannelDefinition[];
};

// The definitions of the channels the config names, one of each kind; the Message URL is the
// server's own, so the config cannot load another.
export async function loadChannels({ specifiers, dataDir, builtInChannels }: LoadChannelsOptions) {
  const definitions: ChannelDefinition[] = [];
  const kinds = new Set<string>([urlKind]);

  for (const specifier of specifiers) {
    const definition =
      builtInChannels.find(({ kind }) => kind === specifier) ??
      (await importChannel({ specifier, dataDir }));

    if (kinds.has(definition.kind)) {
      throw new AppError({
        code: "invalid_input",
        message: `The server has a ${definition.kind} channel already; ${specifier} cannot be another`,
      });
    }

    kinds.add(definition.kind);
    definitions.push(definition);
  }

  return definitions;
}
