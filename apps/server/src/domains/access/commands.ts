import { AppError } from "@artil/errors";
import { shellQuoted } from "@artil/utils/shell";

import { type Command, defineCommand } from "../../platform/commands";
import type { AgentsService } from "../agents/service";
import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import { admitSchema } from "./schema";
import type { AccessService } from "./service";

type AccessCommandsOptions = {
  agents: AgentsService;
  access: AccessService;
  channels: ChannelsService;
  out: (line: string) => void;
};

type SenderOptions = { name: string; kind: ChannelKind; sender: string };

type SetAdmitOptions = { name: string; kind: ChannelKind; who: string };

export function createAccessCommands({ agents, access, channels, out }: AccessCommandsOptions) {
  // The sender as the channel writes it in from.
  function readSender({ kind, sender }: Omit<SenderOptions, "name">) {
    const channel = channels.get(kind);
    const value = channel.readSender(sender);

    if (!value) {
      throw new AppError({ code: "invalid_input", message: `${sender} is not ${channel.senders}` });
    }

    return { channel, value };
  }

  // Someone on the agent's list wakes it on the channel, beside the server's agents.
  function addSender({ name, kind, sender }: SenderOptions) {
    const agent = agents.getByIdOrName(name);
    const { channel, value } = readSender({ kind, sender });
    const added = access.addSender({ agentId: agent.id, channel: kind, sender: value });

    out(
      added
        ? `${value} now wakes ${agent.name} on ${channel.name}.`
        : `${value} already wakes ${agent.name}.`,
    );
  }

  function removeSender({ name, kind, sender }: SenderOptions) {
    const agent = agents.getByIdOrName(name);
    const { channel, value } = readSender({ kind, sender });
    const removed = access.removeSender({ agentId: agent.id, channel: kind, sender: value });

    out(
      removed
        ? `${value} is off ${agent.name}'s list on ${channel.name}.`
        : `${value} was not on ${agent.name}'s list.`,
    );
  }

  // Who wakes the agent on the channel: anyone, the server's agents beside its list, or only the
  // list.
  function setAdmit({ name, kind, who }: SetAdmitOptions) {
    const agent = agents.getByIdOrName(name);
    const channel = channels.get(kind);
    const admit = admitSchema.safeParse(who.trim().toLowerCase()).data;

    if (!admit) {
      throw new AppError({ code: "invalid_input", message: `${who} is not anyone, team or list` });
    }

    access.setAdmit({ agentId: agent.id, channel: kind, admit });

    const woken = {
      anyone: `Anyone now wakes ${agent.name} on ${channel.name}.`,
      team: `The server's agents and ${agent.name}'s list now wake it on ${channel.name}.`,
      list: `Only ${agent.name}'s list now wakes it on ${channel.name}.`,
    } satisfies Record<typeof admit, string>;

    out(woken[admit]);

    const { senders } = access.read({ agentId: agent.id, channel: kind });

    if (admit === "list" && senders.length === 0) {
      out(
        `No one is on it yet; add someone with: artil-server access add ${shellQuoted(agent.name)} ${kind} <sender>`,
      );
    }
  }

  return new Map<string, Command>([
    [
      "access add",
      defineCommand(["account", "channel", "sender"], ({ account, channel, sender }) =>
        addSender({ name: account, kind: channel, sender }),
      ),
    ],
    [
      "access remove",
      defineCommand(["account", "channel", "sender"], ({ account, channel, sender }) =>
        removeSender({ name: account, kind: channel, sender }),
      ),
    ],
    [
      "access set",
      defineCommand(["account", "channel", "who"], ({ account, channel, who }) =>
        setAdmit({ name: account, kind: channel, who }),
      ),
    ],
  ]);
}
