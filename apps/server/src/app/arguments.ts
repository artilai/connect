import { isCancel, select } from "@clack/prompts";

import { AppError } from "@artil/errors";
import { shellQuoted } from "@artil/utils/shell";

import { readChannel } from "../domains/access/commands";
import { everyClient } from "../domains/agents/commands";
import type { CommandContext } from "./context";

type Choice = { value: string; label: string };

type ChooseOptions = {
  message: string;
  choices: readonly Choice[];
  // What to say when there is nothing to choose from.
  none: string;
};

// Picks one of the choices in a terminal; undefined when the person stops.
async function choose({ message, choices, none }: ChooseOptions) {
  if (choices.length === 0) throw new AppError({ code: "invalid_input", message: none });

  const choice = await select({ message, options: [...choices] });

  return isCancel(choice) ? undefined : choice;
}

function toChoice(value: string): Choice {
  return { value, label: value };
}

type ChooserOptions = {
  // The arguments given before the one to choose.
  given: ReadonlyMap<string, string>;
  // The channel --channel names, if it does.
  channel: string | undefined;
};

// Picks an argument a command line left out.
type Chooser = (options: ChooserOptions) => Promise<string | undefined>;

// What a terminal offers for an argument a command line left out, by the argument's name: the
// server's accounts, the channels an account connects to, the clients it is signed in to, and who
// wrote to it and was kept out. A name stays for the command line to give.
export function createArgumentChoosers({
  agents,
  channels,
  tokens,
  addresses,
  access,
  messages,
}: CommandContext) {
  return new Map<string, Chooser>([
    [
      "account",
      () =>
        choose({
          message: "Which account?",
          choices: agents.list().map(({ name }) => toChoice(name)),
          none: "No accounts yet. Create one with: artil-server account create <name>",
        }),
    ],
    [
      "channel",
      () =>
        choose({
          message: "Which channel?",
          choices: channels
            .list()
            .flatMap((channel) => (channel.connect ? [toChoice(channel.kind)] : [])),
          none: "This server has no channel to connect an account to",
        }),
    ],
    [
      "client",
      ({ given }) => {
        const agent = agents.getByIdOrName(given.get("account") ?? "");
        const clients = tokens.listByAgent(agent.id).map(({ name }) => toChoice(name));

        return choose({
          message: `Sign ${agent.name} out of which client?`,
          choices: clients.length > 0 ? [...clients, toChoice(everyClient)] : [],
          none: `${agent.name} is signed in to no client`,
        });
      },
    ],
    [
      "who",
      ({ given, channel: kind }) => {
        const agent = agents.getByIdOrName(given.get("account") ?? "");
        const channel = readChannel({ agent, kind, addresses, channels });
        const listed = new Set(access.read({ agentId: agent.id, channel: channel.kind }).senders);

        const keptOut = messages
          .listKeptOut({ agentId: agent.id, channel: channel.kind })
          .flatMap(({ sender, name }) =>
            listed.has(sender)
              ? []
              : [{ value: sender, label: name ? `${name} (${sender})` : sender }],
          );

        return choose({
          message: `Who of those who wrote to ${agent.name} on ${channel.name} may wake it?`,
          choices: keptOut,
          none: `No one ${agent.name}'s list keeps out has written to it on ${channel.name}; name the sender with: artil-server account allow ${shellQuoted(agent.name)} <${channel.senders}>`,
        });
      },
    ],
  ]);
}
