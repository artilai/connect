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
    const bot = context.addresses.findByAgent({ agentId: agent.id, channel: "telegram" });
    const senders = context.access.read({ agentId: agent.id, channel: "telegram" }).senders;
    const listening = context.connections.isListening(agent.id) ? "listening" : "not listening";

    const details = [
      agent.id,
      listening,
      bot && `Telegram ${bot.value}`,
      senders.length > 0 && `woken by ${senders.join(", ")}`,
    ].filter(Boolean);

    context.out(`${agent.name}  ${details.join(" · ")}`);
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

type ConnectableChannelOptions = { context: CommandContext; kind: ChannelKind };

// The channel a command connects an address of, which has to take credentials.
function connectableChannel({ context, kind }: ConnectableChannelOptions) {
  const channel = context.channels.get(kind);
  const connect = channel?.connect;

  if (!channel || !connect) {
    throw new AppError({ code: "unavailable", message: `This server has no ${kind} channel` });
  }

  return { ...channel, connect };
}

type ConnectTelegramOptions = { context: CommandContext; name: string; token: string };

export async function connectTelegram({ context, name, token }: ConnectTelegramOptions) {
  const agent = agentNamed(context, name);
  const telegram = connectableChannel({ context, kind: "telegram" });
  const { value, credentials } = await telegram.connect(token);

  const { replaced } = context.addresses.connect({
    agentId: agent.id,
    channel: "telegram",
    value,
    credentials,
  });

  for (const old of replaced) {
    await telegram.disconnect?.(old);
    context.out(`${old.value} no longer reaches ${agent.name}.`);
  }

  context.out(
    [
      `${value} now reaches ${agent.name}.`,
      `Only the server's agents wake ${agent.name} there; let a person in with:`,
      `  artil-server access add ${shellQuoted(agent.name)} <their @username or Telegram user id>`,
    ].join("\n"),
  );
}

export async function disconnectTelegram(context: CommandContext, name: string) {
  const agent = agentNamed(context, name);
  const address = context.addresses.disconnect({ agentId: agent.id, channel: "telegram" });

  if (!address) {
    context.out(`${agent.name} has no Telegram bot.`);

    return;
  }

  await connectableChannel({ context, kind: "telegram" }).disconnect?.({
    value: address.value,
    credentials: address.credentials,
  });
  context.out(`${address.value} no longer reaches ${agent.name}.`);
}
