import { shellQuoted } from "@artil/utils/shell";

import {
  type Command,
  type Confirm,
  defineCommand,
  type ReadSecret,
} from "../../platform/commands";
import type { AgentsService } from "../agents/service";
import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import type { AddressesService } from "./service";

type AddressCommandsOptions = {
  agents: AgentsService;
  addresses: AddressesService;
  channels: ChannelsService;
  // Reads what a channel asks for to connect, like a bot's token.
  readSecret: ReadSecret;
  confirm: Confirm;
  out: (line: string) => void;
};

// An account's addresses on the channels, which the commands name by their kind:
// artil-server account connect claude telegram.
export function createAddressCommands({
  agents,
  addresses,
  channels,
  readSecret,
  confirm,
  out,
}: AddressCommandsOptions) {
  type ConnectOptions = { kind: ChannelKind; name: string };

  async function connect({ kind, name }: ConnectOptions) {
    const agent = agents.getByIdOrName(name);
    const channel = addresses.getConnectable(kind);

    const credentials = await readSecret({
      message: channel.credentials,
      guide: channel.credentialsGuide,
    });

    if (credentials === undefined) return;

    const { address, replaced } = await addresses.connect({
      agentId: agent.id,
      kind,
      credentials: credentials.trim(),
    });

    for (const old of replaced) out(`${old.value} no longer reaches ${agent.name}.`);

    out(
      [
        `${address.value} now reaches ${agent.name} on ${channel.name}.`,
        `Only the server's agents wake ${agent.name} there; let someone in with:`,
        `  artil-server account allow ${shellQuoted(agent.name)} <${channel.senders}> --channel ${kind}`,
      ].join("\n"),
    );
  }

  type DisconnectOptions = { kind: ChannelKind; name: string };

  async function disconnect({ kind, name }: DisconnectOptions) {
    const agent = agents.getByIdOrName(name);
    const channel = channels.get(kind);
    const address = addresses.findByAgent({ agentId: agent.id, channel: kind });

    if (!address) return out(`${agent.name} has no ${channel.name} address.`);

    if (!(await confirm(`Disconnect ${address.value} from ${agent.name}?`))) {
      return out("Nothing changed.");
    }

    await addresses.disconnect({ agentId: agent.id, kind });
    out(`${address.value} no longer reaches ${agent.name}.`);
  }

  return new Map<string, Command>([
    [
      "account connect",
      defineCommand({
        takes: ["account", "channel"],
        run: ({ account, channel }) => connect({ kind: channel, name: account }),
      }),
    ],
    [
      "account disconnect",
      defineCommand({
        takes: ["account", "channel"],
        run: ({ account, channel }) => disconnect({ kind: channel, name: account }),
      }),
    ],
  ]);
}
