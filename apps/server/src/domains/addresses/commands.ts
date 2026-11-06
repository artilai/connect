import { shellQuoted } from "@artil/utils/shell";

import { type Command, defineCommand } from "../../platform/commands";
import type { AgentsService } from "../agents/service";
import type { ChannelKind } from "../channels/schema";
import type { AddressesService } from "./service";

type AddressCommandsOptions = {
  agents: AgentsService;
  addresses: AddressesService;
  out: (line: string) => void;
};

// A channel's commands go by its kind: artil-server <kind> connect.
export function createAddressCommands({ agents, addresses, out }: AddressCommandsOptions) {
  type ConnectOptions = { kind: ChannelKind; name: string; credentials: string };

  async function connect({ kind, name, credentials }: ConnectOptions) {
    const agent = agents.getByIdOrName(name);

    const { address, replaced, channel } = await addresses.connect({
      agentId: agent.id,
      kind,
      credentials,
    });

    for (const old of replaced) out(`${old.value} no longer reaches ${agent.name}.`);

    out(
      [
        `${address.value} now reaches ${agent.name} on ${channel.name}.`,
        `Only the server's agents wake ${agent.name} there; let someone in with:`,
        `  artil-server access add ${shellQuoted(agent.name)} ${kind} <${channel.senders}>`,
      ].join("\n"),
    );
  }

  type DisconnectOptions = { kind: ChannelKind; name: string };

  async function disconnect({ kind, name }: DisconnectOptions) {
    const agent = agents.getByIdOrName(name);
    const { address, channel } = await addresses.disconnect({ agentId: agent.id, kind });

    out(
      address
        ? `${address.value} no longer reaches ${agent.name}.`
        : `${agent.name} has no ${channel.name} address.`,
    );
  }

  return new Map<string, (kind: ChannelKind) => Command>([
    [
      "connect",
      (kind) =>
        defineCommand(["agent", "credentials"], ({ agent, credentials }) =>
          connect({ kind, name: agent, credentials }),
        ),
    ],
    [
      "disconnect",
      (kind) => defineCommand(["agent"], ({ agent }) => disconnect({ kind, name: agent })),
    ],
  ]);
}
