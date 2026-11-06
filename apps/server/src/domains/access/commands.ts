import { AppError } from "@artil/errors";

import { type Command, defineCommand } from "../../platform/commands";
import type { AgentsService } from "../agents/service";
import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import type { AccessService } from "./service";

type AccessCommandsOptions = {
  agents: AgentsService;
  access: AccessService;
  channels: ChannelsService;
  out: (line: string) => void;
};

type SenderOptions = { name: string; kind: ChannelKind; sender: string };

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
    const { value } = readSender({ kind, sender });
    const removed = access.removeSender({ agentId: agent.id, channel: kind, sender: value });

    out(
      removed
        ? `${value} no longer wakes ${agent.name}.`
        : `${value} was not on ${agent.name}'s list.`,
    );
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
  ]);
}
