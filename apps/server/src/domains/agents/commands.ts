import { AppError } from "@artil/errors";
import { shellQuoted } from "@artil/utils/shell";

import { loginCommand } from "../../platform/artil-cli";
import { type Command, defineCommand, toRows } from "../../platform/commands";
import { type Access, defaultAccess } from "../access/schema";
import type { AccessService } from "../access/service";
import type { AddressesService } from "../addresses/service";
import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import type { ConnectionsService } from "../connections/service";
import type { TokensService } from "../tokens/service";
import { toMessageUrl, urlKind } from "../url/schema";
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

// The account by its id or present name, and the name it takes.
type RenameAgentOptions = { name: string; newName: string };

type IssueTokenOptions = { name: string; tokenName: string };

// The account, and the client by the name its sign-in goes by, or all of them.
type RevokeOptions = { name: string; client: string };

// The word revoke takes for every client an account is signed in to.
const everyClient = "all";

type DescribeWakersOptions = Access & { kind: ChannelKind };

// How a date shows to a person, like Nov 10, 2026.
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

// How each kind of client signs the agents in to this server.
export function signInGuide({ baseUrl, names }: SignInGuideOptions) {
  return [
    `Sign ${names.length === 1 ? "the agent" : "each agent"} in from its client:`,
    ...names.map((name) => `  ${loginCommand(baseUrl)} --account ${shellQuoted(name)}`),
    `MCP clients connect to ${baseUrl}/mcp and sign in on the page it opens.`,
    "On a computer without a browser, make a token with: artil-server account token <account> <name>",
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
        const listed = senders.map((sender) => channels.showSender(kind, sender)).join(", ");

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

  // Who wakes the agent on the channel, said in full.
  function describeWakers({ kind, admit, senders }: DescribeWakersOptions) {
    const listed = senders.map((sender) => channels.showSender(kind, sender)).join(", ");

    return {
      anyone: "anyone",
      team: listed ? `the server's agents and ${listed}` : "the server's agents",
      list: listed ? `only ${listed}` : "no one",
    }[admit];
  }

  // Everything about the account: where it is reached, the clients it is signed in to, and who
  // wakes it on each channel it has.
  async function showAgent(name: string) {
    const agent = agents.getByIdOrName(name);
    const listening = connections.isListening(agent.id);
    const connection = connections.findByAgent(agent.id);
    const agentAddresses = addresses.listByAgent(agent.id);
    const signIns = tokens.listByAgent(agent.id);
    const serverUrl = await baseUrl();

    // The client that listens through one of the sign-ins, like Claude Code on MacBook.
    const listener = connection && {
      tokenId: connection.tokenId,
      note: `${connection.machine ? `${connection.client} on ${connection.machine}` : connection.client}, ${listening ? "listening" : "not listening now"}`,
    };

    const clientRows = signIns.map(({ id, name: clientName, createdAt }) => {
      const since = `signed in ${dateFormat.format(createdAt)}`;

      return [
        clientName,
        listener?.tokenId === id ? `${since} · ${listener.note}` : since,
      ] as const;
    });

    const connectedKinds = new Set(agentAddresses.map(({ channel }) => channel));

    // The Message URL first, then each channel the account has an address on, or a list of its own
    // for, which it can have before it connects one.
    const wakerRows = [
      channels.get(urlKind),
      ...channels.list().filter(({ kind }) => kind !== urlKind),
    ].flatMap(({ kind, name: channelName }) => {
      const wakers = access.read({ agentId: agent.id, channel: kind });

      const shown =
        kind === urlKind ||
        connectedKinds.has(kind) ||
        wakers.admit !== defaultAccess.admit ||
        wakers.senders.length > 0;

      return shown ? [[channelName, describeWakers({ kind, ...wakers })] as const] : [];
    });

    out(
      [
        `${agent.name}  ${agent.id} · ${listening ? "listening" : "not listening"}`,
        "Addresses:",
        ...toRows([
          ["Message URL", toMessageUrl({ baseUrl: serverUrl, agentId: agent.id })],
          ...agentAddresses.map(
            ({ channel, value }) => [channels.get(channel).name, value] as const,
          ),
        ]),
        "Clients:",
        ...(clientRows.length > 0
          ? toRows(clientRows)
          : [
              `  none yet; sign one in with: ${loginCommand(serverUrl)} --account ${shellQuoted(agent.name)}`,
            ]),
        "Who wakes it:",
        ...toRows(wakerRows),
      ].join("\n"),
    );
  }

  function renameAgent({ name, newName }: RenameAgentOptions) {
    const agent = agents.getByIdOrName(name);
    const renamed = agents.rename({ id: agent.id, name: newName });

    out(`Renamed ${agent.name} to ${renamed}.`);
  }

  async function removeAgent(name: string) {
    const agent = agents.getByIdOrName(name);

    await agents.remove(agent.id);
    out(`Removed ${agent.name}, with its messages and sign-ins.`);
  }

  // A token's name, which revoke takes it by; all is a word of its own there.
  function readTokenName(given: string) {
    const tokenName = given.trim();

    if (!tokenName || tokenName.toLowerCase() === everyClient) {
      throw new AppError({
        code: "invalid_input",
        message: `Name the token after where it signs in, like macbook, and not ${everyClient}`,
      });
    }

    return tokenName;
  }

  // A token for a computer without a browser, where the sign-in page cannot send its code back.
  async function issueToken({ name, tokenName }: IssueTokenOptions) {
    const agent = agents.getByIdOrName(name);
    const named = readTokenName(tokenName);
    const token = tokens.issue({ agentId: agent.id, name: named });

    out(
      [
        `A token for ${agent.name}, named ${named}. Keep it secret; it signs in as the agent until you revoke it.`,
        `  ${loginCommand(await baseUrl())} --token ${token}`,
      ].join("\n"),
    );
  }

  function revoke({ name, client }: RevokeOptions) {
    const agent = agents.getByIdOrName(name);

    if (client.trim().toLowerCase() === everyClient) {
      const revoked = tokens.revokeByAgent(agent.id);

      return out(`Signed ${agent.name} out of ${revoked} ${revoked === 1 ? "client" : "clients"}.`);
    }

    if (tokens.revokeByName({ agentId: agent.id, name: client }) === 0) {
      const clients = tokens.listByAgent(agent.id).map((token) => token.name);

      throw new AppError({
        code: "not_found",
        message:
          clients.length === 0
            ? `${agent.name} is signed in to no client`
            : `${agent.name} has no client ${client}; it has ${clients.join(", ")}`,
      });
    }

    out(`Signed ${agent.name} out of ${client.trim()}.`);
  }

  return new Map<string, Command>([
    ["account create", defineCommand({ takes: ["name"], run: ({ name }) => createAgent(name) })],
    ["account list", defineCommand({ takes: [], run: () => listAgents() })],
    [
      "account show",
      defineCommand({ takes: ["account"], run: ({ account }) => showAgent(account) }),
    ],
    [
      "account rename",
      defineCommand({
        takes: ["account", "name"],
        run: ({ account, name }) => renameAgent({ name: account, newName: name }),
      }),
    ],
    ["account remove", defineCommand({ takes: ["name"], run: ({ name }) => removeAgent(name) })],
    [
      "account token",
      defineCommand({
        takes: ["account", "name"],
        run: ({ account, name }) => issueToken({ name: account, tokenName: name }),
      }),
    ],
    [
      "account revoke",
      defineCommand({
        takes: ["account", "client"],
        run: ({ account, client }) => revoke({ name: account, client }),
      }),
    ],
  ]);
}
