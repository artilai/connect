import { isCancel, select } from "@clack/prompts";

import { AppError } from "@artil/errors";

import { everyClient } from "../domains/agents/commands";
import type { CommandContext } from "./context";

type ChooseOptions = {
  message: string;
  choices: readonly string[];
  // What to say when there is nothing to choose from.
  none: string;
};

// Picks one of the choices in a terminal; undefined when the person stops.
async function choose({ message, choices, none }: ChooseOptions) {
  if (choices.length === 0) throw new AppError({ code: "invalid_input", message: none });

  const choice = await select({
    message,
    options: choices.map((value) => ({ value, label: value })),
  });

  return isCancel(choice) ? undefined : choice;
}

// Picks an argument a command line left out, from the arguments given before it.
type Chooser = (given: ReadonlyMap<string, string>) => Promise<string | undefined>;

// What a terminal offers for an argument a command line left out, by the argument's name: the
// server's accounts, the channels an account connects to, and the clients it is signed in to. A
// name or a sender stays for the command line to give.
export function createArgumentChoosers({ agents, channels, tokens }: CommandContext) {
  return new Map<string, Chooser>([
    [
      "account",
      () =>
        choose({
          message: "Which account?",
          choices: agents.list().map(({ name }) => name),
          none: "No accounts yet. Create one with: artil-server account create <name>",
        }),
    ],
    [
      "channel",
      () =>
        choose({
          message: "Which channel?",
          choices: channels.list().flatMap((channel) => (channel.connect ? [channel.kind] : [])),
          none: "This server has no channel to connect an account to",
        }),
    ],
    [
      "client",
      (given) => {
        const agent = agents.getByIdOrName(given.get("account") ?? "");
        const clients = tokens.listByAgent(agent.id).map(({ name }) => name);

        return choose({
          message: `Sign ${agent.name} out of which client?`,
          choices: clients.length > 0 ? [...clients, everyClient] : [],
          none: `${agent.name} is signed in to no client`,
        });
      },
    ],
  ]);
}
