import type { Channel } from "@artil/channels/contract";
import { AppError } from "@artil/errors";
import { shellQuoted } from "@artil/utils/shell";

import { type Command, defineCommand } from "../../platform/commands";
import type { AccountsService } from "../accounts/service";
import type { AddressesService } from "../addresses/service";
import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import { type Admit, groups } from "./schema";
import type { AccessService } from "./service";

type AccessCommandsOptions = {
  accounts: AccountsService;
  addresses: AddressesService;
  access: AccessService;
  channels: ChannelsService;
  out: (line: string) => void;
};

type Account = { id: string; name: string };

// Whom a command lets wake the account's agent or keeps out, on the channel --channel names.
type WhoOptions = { name: string; who: string; kind: ChannelKind | undefined };

type ReadChannelOptions = {
  account: Account;
  kind: ChannelKind | undefined;
  addresses: AddressesService;
  channels: ChannelsService;
};

type ReadSenderOptions = { channel: Channel; who: string };

type SayWokenOptions = { account: Account; channel: Channel; admit: Admit; changed: boolean };

// The channel --channel names, or else the one the account is connected to, as allow and
// disallow take it and the terminal picks a sender on.
export function readChannel({ account, kind, addresses, channels }: ReadChannelOptions) {
  if (kind) return channels.get(kind);

  const connected = [...new Set(addresses.listByAccount(account.id).map(({ channel }) => channel))];
  const [onlyKind] = connected;

  if (!onlyKind || connected.length > 1) {
    const named = connected.length === 0 ? "no channel" : connected.join(" and ");

    throw new AppError({
      code: "invalid_input",
      message: `${account.name} is connected to ${named}; name one with --channel`,
    });
  }

  return channels.get(onlyKind);
}

export function createAccessCommands({
  accounts,
  addresses,
  access,
  channels,
  out,
}: AccessCommandsOptions) {
  // The sender as the channel writes it in from.
  function readSender({ channel, who }: ReadSenderOptions) {
    const sender = channel.parseSender(who);

    if (!sender) {
      throw new AppError({
        code: "invalid_input",
        message: `${who} is not a ${channel.name} ${channel.labels.contact}`,
      });
    }

    return sender;
  }

  // Anyone or the team, when a command names one of them rather than a sender.
  function readGroup(who: string) {
    return groups.find((group) => group === who.trim().toLowerCase());
  }

  // Says who wakes the agent once anyone or the team came in or went out.
  function sayWoken({ account, channel, admit, changed }: SayWokenOptions) {
    const now = changed ? " now" : "";

    const woken = {
      anyone: `Anyone${now} wakes ${account.name} on ${channel.name}.`,
      team: `The server's accounts and ${account.name}'s list${now} wake it on ${channel.name}.`,
      list: `Only ${account.name}'s list${now} wakes it on ${channel.name}.`,
    } satisfies Record<Admit, string>;

    const { senders } = access.read({ accountId: account.id, channel: channel.kind });

    const hint =
      admit === "list" && senders.length === 0
        ? `\nNo one is on it yet; add someone with:\n  artil-server account allow ${shellQuoted(account.name)} <sender> --channel ${channel.kind}`
        : "";

    out(`${woken[admit]}${hint}`);
  }

  // A sender, the team or anyone wakes the agent on the channel from now on.
  function allow({ name, who, kind }: WhoOptions) {
    const account = accounts.getByIdOrName(name);
    const channel = readChannel({ account, kind, addresses, channels });
    const group = readGroup(who);

    if (group) {
      const woken = access.addGroup({ accountId: account.id, channel: channel.kind, group });

      return sayWoken({ account, channel, ...woken });
    }

    const sender = readSender({ channel, who });
    const added = access.addSender({ accountId: account.id, channel: channel.kind, sender });
    const shown = accounts.toSenderName(sender);

    out(
      added
        ? `${shown} now wakes ${account.name} on ${channel.name}.`
        : `${shown} already wakes ${account.name}.`,
    );
  }

  // A sender, the team or anyone no longer wakes the agent on the channel.
  function disallow({ name, who, kind }: WhoOptions) {
    const account = accounts.getByIdOrName(name);
    const channel = readChannel({ account, kind, addresses, channels });
    const group = readGroup(who);

    if (group) {
      const woken = access.removeGroup({ accountId: account.id, channel: channel.kind, group });

      return sayWoken({ account, channel, ...woken });
    }

    const sender = readSender({ channel, who });
    const removed = access.removeSender({ accountId: account.id, channel: channel.kind, sender });
    const shown = accounts.toSenderName(sender);

    out(
      removed
        ? `${shown} is off ${account.name}'s list on ${channel.name}.`
        : `${shown} was not on ${account.name}'s list.`,
    );
  }

  return new Map<string, Command>([
    [
      "account allow",
      defineCommand({
        takes: ["account", "who"],
        flags: ["channel"],
        run: ({ account, who, channel }) => allow({ name: account, who, kind: channel }),
      }),
    ],
    [
      "account disallow",
      defineCommand({
        takes: ["account", "who"],
        flags: ["channel"],
        run: ({ account, who, channel }) => disallow({ name: account, who, kind: channel }),
      }),
    ],
  ]);
}
