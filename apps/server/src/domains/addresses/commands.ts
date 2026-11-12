import { shellQuoted } from "@artil/utils/shell";

import {
  type Command,
  type Confirm,
  defineCommand,
  type ReadSecret,
} from "../../platform/commands";
import type { AccountsService } from "../accounts/service";
import type { ChannelKind } from "../channels/schema";
import type { AddressesService } from "./service";

type AddressCommandsOptions = {
  accounts: AccountsService;
  addresses: AddressesService;
  // Reads what a channel asks for to connect, like a bot's token.
  readSecret: ReadSecret;
  confirm: Confirm;
  out: (line: string) => void;
};

// An account's addresses on the channels, which the commands name by their kind:
// artil-connect account connect claude telegram.
export function createAddressCommands({
  accounts,
  addresses,
  readSecret,
  confirm,
  out,
}: AddressCommandsOptions) {
  type ConnectOptions = { kind: ChannelKind; name: string };

  async function connect({ kind, name }: ConnectOptions) {
    const account = accounts.getByIdOrName(name);
    const channel = addresses.getConnectable(kind);
    const guide = channel.tokenGuide?.(account.name);

    if (guide) out(`Connect ${channel.name} to ${account.name}\n${guide}`);

    const token = await readSecret({
      message: `${channel.name} ${channel.labels.token ?? "token"}`,
    });

    if (!token) return;

    const { address, replaced } = await addresses.connect({
      accountId: account.id,
      kind,
      token: token.trim(),
    });

    for (const old of replaced) out(`${old.value} no longer reaches ${account.name}.`);

    out(
      [
        `${address.value} now reaches ${account.name} on ${channel.name}.`,
        `Only the server's accounts wake ${account.name} there; let someone in with:`,
        `  artil-connect account allow ${shellQuoted(account.name)} <${channel.labels.contact}> --channel ${kind}`,
      ].join("\n"),
    );
  }

  type DisconnectOptions = { kind: ChannelKind; name: string };

  async function disconnect({ kind, name }: DisconnectOptions) {
    const account = accounts.getByIdOrName(name);
    const channel = addresses.getConnectable(kind);
    const address = addresses.findByAccount({ accountId: account.id, channel: kind });

    if (!address) return out(`${account.name} has no ${channel.name} address.`);

    if (!(await confirm(`Disconnect ${address.value} from ${account.name}?`))) {
      return out("Nothing changed.");
    }

    await addresses.disconnect({ accountId: account.id, kind });
    out(`${address.value} no longer reaches ${account.name}.`);
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
