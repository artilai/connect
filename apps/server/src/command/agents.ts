import { AppError } from "@artil/errors";
import { shellQuoted } from "@artil/utils/shell";

import type { ChannelKind } from "../channels/kinds";
import type { CommandContext } from "./context";

export function agentNamed(context: CommandContext, name: string) {
  const agent = context.agents.findByIdOrName(name);

  if (!agent) {
    throw new AppError({
      code: "not_found",
      message: `There is no agent ${name}; see artil-server agent list`,
    });
  }

  return agent;
}

type SignInGuideOptions = { baseUrl: string; names: readonly string[] };

// How each kind of client signs the agents in to this server.
export function signInGuide({ baseUrl, names }: SignInGuideOptions) {
  return [
    `Sign ${names.length === 1 ? "the agent" : "each agent"} in from its client:`,
    ...names.map(
      (name) => `  ARTIL_BASE_URL=${baseUrl} artil auth login --account ${shellQuoted(name)}`,
    ),
    `MCP clients connect to ${baseUrl}/mcp and sign in on the page it opens.`,
    "On a computer without a browser, make a token with: artil-server agent token <name>",
  ].join("\n");
}

export async function createAgent(context: CommandContext, name: string) {
  const agent = context.agents.create(name);

  context.out(`Created ${agent.name} (${agent.id}).`);
  context.out(signInGuide({ baseUrl: await context.baseUrl(), names: [agent.name] }));
}

export function listAgents(context: CommandContext) {
  const agents = context.agents.list();

  if (agents.length === 0) {
    context.out("No agents yet. Create one with: artil-server agent create <name>");

    return;
  }

  for (const agent of agents) {
    const listening = context.connections.isListening(agent.id) ? "listening" : "not listening";

    const addresses = context.addresses
      .listByAgent(agent.id)
      .map(({ channel, value }) => `${channelOf({ context, kind: channel }).name} ${value}`);

    const senders = [...context.channels.values()].flatMap(({ kind, name }) => {
      const listed = context.access.read({ agentId: agent.id, channel: kind }).senders;

      return listed.length > 0 ? [`woken on ${name} by ${listed.join(", ")}`] : [];
    });

    context.out(`${agent.name}  ${[agent.id, listening, ...addresses, ...senders].join(" · ")}`);
  }
}

export async function removeAgent(context: CommandContext, name: string) {
  const agent = agentNamed(context, name);

  await context.files.removeByAgent(agent.id);
  context.agents.remove(agent.id);
  context.out(`Removed ${agent.name}, with its messages and sign-ins.`);
}

// A token for a computer without a browser, where the sign-in page cannot send its code back.
export async function issueToken(context: CommandContext, name: string) {
  const agent = agentNamed(context, name);
  const token = context.tokens.issue({ agentId: agent.id, name: "artil-server agent token" });

  context.out(
    [
      `A token for ${agent.name}. Keep it secret; it signs in as the agent until you revoke it.`,
      `  ARTIL_BASE_URL=${await context.baseUrl()} artil auth login --token ${token}`,
    ].join("\n"),
  );
}

export function revokeTokens(context: CommandContext, name: string) {
  const agent = agentNamed(context, name);
  const revoked = context.tokens.revokeByAgent(agent.id);

  context.out(`Signed ${agent.name} out of ${revoked} ${revoked === 1 ? "client" : "clients"}.`);
}

type ChannelOfOptions = { context: CommandContext; kind: ChannelKind };

// One of the server's channels, which a command names by its kind.
export function channelOf({ context, kind }: ChannelOfOptions) {
  const channel = context.channels.get(kind);

  if (!channel) {
    const kinds = [...context.channels.keys()].join(", ");

    throw new AppError({
      code: "invalid_input",
      message: `This server has no ${kind} channel; it has ${kinds}`,
    });
  }

  return channel;
}

type ConnectAddressOptions = {
  context: CommandContext;
  kind: ChannelKind;
  name: string;
  credentials: string;
};

// Connects an address of the channel to the agent, like a Telegram bot by its token.
export async function connectAddress({
  context,
  kind,
  name,
  credentials: given,
}: ConnectAddressOptions) {
  const agent = agentNamed(context, name);
  const channel = channelOf({ context, kind });

  if (!channel.connect) {
    throw new AppError({
      code: "invalid_input",
      message: `Every agent has its ${channel.name} already; there is nothing to connect`,
    });
  }

  const { value, credentials } = await channel.connect(given);

  const { replaced } = context.addresses.connect({
    agentId: agent.id,
    channel: kind,
    value,
    credentials,
  });

  for (const old of replaced) {
    await channel.disconnect?.(old);
    context.out(`${old.value} no longer reaches ${agent.name}.`);
  }

  context.out(
    [
      `${value} now reaches ${agent.name} on ${channel.name}.`,
      `Only the server's agents wake ${agent.name} there; let someone in with:`,
      `  artil-server access add ${shellQuoted(agent.name)} ${kind} <${channel.senders?.description ?? "sender"}>`,
    ].join("\n"),
  );
}

type DisconnectAddressOptions = { context: CommandContext; kind: ChannelKind; name: string };

export async function disconnectAddress({ context, kind, name }: DisconnectAddressOptions) {
  const agent = agentNamed(context, name);
  const channel = channelOf({ context, kind });
  const address = context.addresses.disconnect({ agentId: agent.id, channel: kind });

  if (!address) {
    context.out(`${agent.name} has no ${channel.name} address.`);

    return;
  }

  await channel.disconnect?.({ value: address.value, credentials: address.credentials });
  context.out(`${address.value} no longer reaches ${agent.name}.`);
}
