import { shellQuoted } from "@artil/utils/shell";

import { loginCommand } from "../../platform/artil-cli";
import { type Command, defineCommand } from "../../platform/commands";
import type { AccessService } from "../access/service";
import type { AddressesService } from "../addresses/service";
import type { ChannelsService } from "../channels/service";
import type { ConnectionsService } from "../connections/service";
import type { TokensService } from "../tokens/service";
import type { AgentsService } from "./service";

type AgentCommandsOptions = {
  agents: AgentsService;
  tokens: TokensService;
  addresses: AddressesService;
  access: AccessService;
  connections: ConnectionsService;
  channels: ChannelsService;
  out: (line: string) => void;
  // Where agents reach the server, to tell them how to sign in.
  baseUrl: () => Promise<string>;
};

type SignInGuideOptions = { baseUrl: string; names: readonly string[] };

// How each kind of client signs the agents in to this server.
export function signInGuide({ baseUrl, names }: SignInGuideOptions) {
  return [
    `Sign ${names.length === 1 ? "the agent" : "each agent"} in from its client:`,
    ...names.map((name) => `  ${loginCommand(baseUrl)} --account ${shellQuoted(name)}`),
    `MCP clients connect to ${baseUrl}/mcp and sign in on the page it opens.`,
    "On a computer without a browser, make a token with: artil-server account token <name>",
  ].join("\n");
}

export function createAgentCommands({
  agents,
  tokens,
  addresses,
  access,
  connections,
  channels,
  out,
  baseUrl,
}: AgentCommandsOptions) {
  async function createAgent(name: string) {
    const agent = agents.create(name);

    out(`Created ${agent.name} (${agent.id}).`);
    out(signInGuide({ baseUrl: await baseUrl(), names: [agent.name] }));
  }

  function listAgents() {
    const list = agents.list();

    if (list.length === 0) {
      out("No accounts yet. Create one with: artil-server account create <name>");

      return;
    }

    for (const agent of list) {
      const listening = connections.isListening(agent.id) ? "listening" : "not listening";

      const agentAddresses = addresses
        .listByAgent(agent.id)
        .map(({ channel, value }) => `${channels.get(channel).name} ${value}`);

      // What differs from the default, where only the server's agents wake the agent.
      const wakers = channels.list().flatMap(({ kind, name }) => {
        const { admit, senders } = access.read({ agentId: agent.id, channel: kind });
        const listed = senders.join(", ");

        const woken = {
          anyone: "by anyone",
          team: listed && `by ${listed}`,
          list: listed ? `only by ${listed}` : "by no one",
        }[admit];

        return woken ? [`woken on ${name} ${woken}`] : [];
      });

      out(`${agent.name}  ${[agent.id, listening, ...agentAddresses, ...wakers].join(" · ")}`);
    }
  }

  async function removeAgent(name: string) {
    const agent = agents.getByIdOrName(name);

    await agents.remove(agent.id);
    out(`Removed ${agent.name}, with its messages and sign-ins.`);
  }

  // A token for a computer without a browser, where the sign-in page cannot send its code back.
  async function issueToken(name: string) {
    const agent = agents.getByIdOrName(name);
    const token = tokens.issue({ agentId: agent.id, name: "artil-server account token" });

    out(
      [
        `A token for ${agent.name}. Keep it secret; it signs in as the agent until you revoke it.`,
        `  ${loginCommand(await baseUrl())} --token ${token}`,
      ].join("\n"),
    );
  }

  function revokeTokens(name: string) {
    const agent = agents.getByIdOrName(name);
    const revoked = tokens.revokeByAgent(agent.id);

    out(`Signed ${agent.name} out of ${revoked} ${revoked === 1 ? "client" : "clients"}.`);
  }

  return new Map<string, Command>([
    ["account create", defineCommand({ takes: ["name"], run: ({ name }) => createAgent(name) })],
    ["account list", defineCommand({ takes: [], run: () => listAgents() })],
    ["account remove", defineCommand({ takes: ["name"], run: ({ name }) => removeAgent(name) })],
    ["account token", defineCommand({ takes: ["name"], run: ({ name }) => issueToken(name) })],
    ["account revoke", defineCommand({ takes: ["name"], run: ({ name }) => revokeTokens(name) })],
  ]);
}
