import { AppError } from "@artil/errors";

import type { ChannelKind } from "../channels/kinds";
import { agentNamed, channelOf } from "./agents";
import type { CommandContext } from "./context";

type SenderOptions = { context: CommandContext; name: string; kind: ChannelKind; sender: string };

// The sender as the channel writes it in from.
function readSender({ context, kind, sender }: Omit<SenderOptions, "name">) {
  const channel = channelOf({ context, kind });

  if (!channel.senders) return { channel, value: sender.trim() };

  const value = channel.senders.read(sender);

  if (!value) {
    throw new AppError({
      code: "invalid_input",
      message: `${sender} is not ${channel.senders.description}`,
    });
  }

  return { channel, value };
}

// Someone on the agent's list wakes it on the channel, beside the server's agents.
export function addSender({ context, name, kind, sender }: SenderOptions) {
  const agent = agentNamed(context, name);
  const { channel, value } = readSender({ context, kind, sender });
  const added = context.access.addSender({ agentId: agent.id, channel: kind, sender: value });

  context.out(
    added
      ? `${value} now wakes ${agent.name} on ${channel.name}.`
      : `${value} already wakes ${agent.name}.`,
  );
}

export function removeSender({ context, name, kind, sender }: SenderOptions) {
  const agent = agentNamed(context, name);
  const { value } = readSender({ context, kind, sender });
  const removed = context.access.removeSender({ agentId: agent.id, channel: kind, sender: value });

  context.out(
    removed
      ? `${value} no longer wakes ${agent.name}.`
      : `${value} was not on ${agent.name}'s list.`,
  );
}
