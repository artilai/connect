import type { Channel } from "@artil/channels/contract";
import { AppError } from "@artil/errors";
import { shellQuoted } from "@artil/utils/shell";

import { type Command, defineCommand } from "../../platform/commands";
import type { AddressesService } from "../addresses/service";
import type { AgentsService } from "../agents/service";
import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import { type Admit, groups } from "./schema";
import type { AccessService } from "./service";

type AccessCommandsOptions = {
  agents: AgentsService;
  addresses: AddressesService;
  access: AccessService;
  channels: ChannelsService;
  out: (line: string) => void;
};

type Agent = { id: string; name: string };

// Whom a command lets wake the account's agent or keeps out, on the channel --channel names.
type WhoOptions = { name: string; who: string; kind: ChannelKind | undefined };

type ReadChannelOptions = { agent: Agent; kind: ChannelKind | undefined };

type ReadSenderOptions = { channel: Channel; who: string };

type SayWokenOptions = { agent: Agent; channel: Channel; admit: Admit; changed: boolean };

export function createAccessCommands({
  agents,
  addresses,
  access,
  channels,
  out,
}: AccessCommandsOptions) {
  // The channel --channel names, or else the one the account is connected to.
  function readChannel({ agent, kind }: ReadChannelOptions) {
    if (kind !== undefined) return channels.get(kind);

    const connected = [...new Set(addresses.listByAgent(agent.id).map(({ channel }) => channel))];
    const [onlyKind] = connected;

    if (onlyKind === undefined || connected.length > 1) {
      const named = connected.length === 0 ? "no channel" : connected.join(" and ");

      throw new AppError({
        code: "invalid_input",
        message: `${agent.name} is connected to ${named}; name one with --channel`,
      });
    }

    return channels.get(onlyKind);
  }

  // The sender as the channel writes it in from.
  function readSender({ channel, who }: ReadSenderOptions) {
    const sender = channel.readSender(who);

    if (!sender) {
      throw new AppError({ code: "invalid_input", message: `${who} is not ${channel.senders}` });
    }

    return sender;
  }

  // Anyone or the team, when a command names one of them rather than a sender.
  function readGroup(who: string) {
    return groups.find((group) => group === who.trim().toLowerCase());
  }

  // Says who wakes the agent once anyone or the team came in or went out.
  function sayWoken({ agent, channel, admit, changed }: SayWokenOptions) {
    const now = changed ? " now" : "";

    const woken = {
      anyone: `Anyone${now} wakes ${agent.name} on ${channel.name}.`,
      team: `The server's agents and ${agent.name}'s list${now} wake it on ${channel.name}.`,
      list: `Only ${agent.name}'s list${now} wakes it on ${channel.name}.`,
    } satisfies Record<Admit, string>;

    out(woken[admit]);

    const { senders } = access.read({ agentId: agent.id, channel: channel.kind });

    if (admit === "list" && senders.length === 0) {
      out(
        `No one is on it yet; add someone with: artil-server account allow ${shellQuoted(agent.name)} <sender> --channel ${channel.kind}`,
      );
    }
  }

  // A sender, the team or anyone wakes the agent on the channel from now on.
  function allow({ name, who, kind }: WhoOptions) {
    const agent = agents.getByIdOrName(name);
    const channel = readChannel({ agent, kind });
    const group = readGroup(who);

    if (group) {
      const woken = access.addGroup({ agentId: agent.id, channel: channel.kind, group });

      return sayWoken({ agent, channel, ...woken });
    }

    const sender = readSender({ channel, who });
    const added = access.addSender({ agentId: agent.id, channel: channel.kind, sender });

    out(
      added
        ? `${sender} now wakes ${agent.name} on ${channel.name}.`
        : `${sender} already wakes ${agent.name}.`,
    );
  }

  // A sender, the team or anyone no longer wakes the agent on the channel.
  function disallow({ name, who, kind }: WhoOptions) {
    const agent = agents.getByIdOrName(name);
    const channel = readChannel({ agent, kind });
    const group = readGroup(who);

    if (group) {
      const woken = access.removeGroup({ agentId: agent.id, channel: channel.kind, group });

      return sayWoken({ agent, channel, ...woken });
    }

    const sender = readSender({ channel, who });
    const removed = access.removeSender({ agentId: agent.id, channel: channel.kind, sender });

    out(
      removed
        ? `${sender} is off ${agent.name}'s list on ${channel.name}.`
        : `${sender} was not on ${agent.name}'s list.`,
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
