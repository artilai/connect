import { AppError } from "@artil/errors";
import { readSender } from "@artil/telegram-channel/chats";

import { agentNamed } from "./agents";
import type { CommandContext } from "./context";

type SenderOptions = { context: CommandContext; name: string; sender: string };

function normalizeTelegramSender(sender: string) {
  const read = readSender(sender);

  if (!read) {
    throw new AppError({
      code: "invalid_input",
      message: `${sender} is not a Telegram @username, user id or bot`,
    });
  }

  return read;
}

// People on the list wake the agent on Telegram, beside the server's agents.
export function addSender({ context, name, sender }: SenderOptions) {
  const agent = agentNamed(context, name);
  const value = normalizeTelegramSender(sender);
  const added = context.access.addSender({ agentId: agent.id, channel: "telegram", sender: value });

  context.out(
    added
      ? `${value} now wakes ${agent.name} on Telegram.`
      : `${value} already wakes ${agent.name}.`,
  );
}

export function removeSender({ context, name, sender }: SenderOptions) {
  const agent = agentNamed(context, name);
  const value = normalizeTelegramSender(sender);

  const removed = context.access.removeSender({
    agentId: agent.id,
    channel: "telegram",
    sender: value,
  });

  context.out(
    removed
      ? `${value} no longer wakes ${agent.name}.`
      : `${value} was not on ${agent.name}'s list.`,
  );
}
