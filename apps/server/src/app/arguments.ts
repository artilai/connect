import { isCancel, select } from "@clack/prompts";

import { AppError } from "@artil/errors";
import { shellQuoted } from "@artil/utils/shell";

import { readChannel } from "../domains/access/commands";
import { everyClient } from "../domains/accounts/commands";
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
  channel?: string;
};

// Picks an argument a command line left out.
type Chooser = (options: ChooserOptions) => Promise<string | undefined>;

// What a terminal offers for an argument a command line left out, by the argument's name, or by
// the command and the name where one command offers something else: the server's accounts, the
// channels an account connects to, the clients it is signed in to, who wrote to it and was kept out,
// and who is on its list. A name stays for the command line to give.
export function createArgumentChoosers({
  accounts,
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
          choices: accounts.list().map(({ name }) => toChoice(name)),
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
        const account = accounts.getByIdOrName(given.get("account") ?? "");
        const clients = tokens.listByAccount(account.id).map(({ name }) => toChoice(name));

        return choose({
          message: `Sign ${account.name} out of which client?`,
          choices: clients.length > 0 ? [...clients, toChoice(everyClient)] : [],
          none: `${account.name} is signed in to no client`,
        });
      },
    ],
    [
      "who",
      ({ given, channel: kind }) => {
        const account = accounts.getByIdOrName(given.get("account") ?? "");
        const channel = readChannel({ account, kind, addresses, channels });

        const listed = new Set(
          access.read({ accountId: account.id, channel: channel.kind }).senders,
        );

        const keptOut = messages
          .listKeptOut({ accountId: account.id, channel: channel.kind })
          .flatMap(({ sender, name }) =>
            listed.has(sender)
              ? []
              : [{ value: sender, label: name ? `${name} (${sender})` : sender }],
          );

        return choose({
          message: `Who of those who wrote to ${account.name} on ${channel.name} may wake it?`,
          choices: keptOut,
          none: `No one ${account.name}'s list keeps out has written to it on ${channel.name}; name the sender with: artil-server account allow ${shellQuoted(account.name)} <${channel.labels.contact}>`,
        });
      },
    ],
    // What disallow takes away: whoever is on the list, and anyone or the team where they come in.
    [
      "account disallow who",
      ({ given, channel: kind }) => {
        const account = accounts.getByIdOrName(given.get("account") ?? "");
        const channel = readChannel({ account, kind, addresses, channels });
        const { admit, senders } = access.read({ accountId: account.id, channel: channel.kind });
        const comingIn = { anyone: ["anyone", "team"], team: ["team"], list: [] }[admit];

        return choose({
          message: `Who may no longer wake ${account.name} on ${channel.name}?`,
          choices: [
            ...senders.map((sender) => ({
              value: sender,
              label: accounts.toSenderName(sender),
            })),
            ...comingIn.map(toChoice),
          ],
          none: `Only ${account.name}'s list wakes it on ${channel.name}, and no one is on it`,
        });
      },
    ],
  ]);
}
