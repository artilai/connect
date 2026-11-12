import { styleText } from "node:util";

import { confirm, isCancel, log, note, password } from "@clack/prompts";

import { AppError } from "@artil/errors";

// A command of the artil-connect command line: the arguments it takes in order and the flags it
// reads beside them, like --channel, by the names it reads them under, and what it does with them.
export type Command = {
  takes: readonly string[];
  flags: readonly string[];
  run: (values: Record<string, string>) => Promise<void> | void;
};

type DefineCommandOptions<Names extends readonly string[], Flags extends readonly string[]> = {
  takes: Names;
  flags?: Flags;
  // A flag the command line leaves out is undefined.
  run: (
    values: Record<Names[number], string> & Record<Flags[number], string | undefined>,
  ) => Promise<void> | void;
};

export function defineCommand<
  const Names extends readonly string[],
  const Flags extends readonly string[] = [],
>({ takes, flags, run }: DefineCommandOptions<Names, Flags>): Command {
  return { takes, flags: flags ?? [], run };
}

// Lines of a label and a value each under a heading, with the values lined up.
export function toRows(pairs: readonly (readonly [string, string])[]) {
  const width = Math.max(...pairs.map(([label]) => label.length)) + 2;

  return pairs.map(([label, value]) => `  ${label.padEnd(width)}${value}`);
}

// A command to run, on a line of its own under what it is for, like "  artil auth login".
const commandLine = /^( +)(artil(?:-connect)? .+)$/gmv;

// What a box adds to the width of its lines: a bar and padding on either side.
const boxEdges = 6;

// Shows the commands a text gives in color.
export function highlightCommands(text: string) {
  return text.replaceAll(
    commandLine,
    (_, indent: string, command: string) => `${indent}${styleText("cyan", command)}`,
  );
}

type CreateOutOptions = {
  // Whether a person reads what the commands say in a terminal, rather than a pipe or a script.
  terminal: boolean;
  columns: () => number;
  write: (text: string) => void;
};

// Says what a command has to say, whose first line heads the rest. A terminal frames the rest in a
// box, or beside a bar when a line is too wide for the box, which would break that line in two.
export function createOut({ terminal, columns, write }: CreateOutOptions) {
  if (!terminal) return write;

  return (text: string) => {
    const lines = text.split("\n");
    const [title = "", ...body] = lines;
    const widest = Math.max(...lines.map((line) => line.length));

    if (body.length > 0 && widest + boxEdges <= columns()) {
      note(highlightCommands(body.join("\n")), title, { withGuide: false });
    } else {
      log.step(highlightCommands(text), { spacing: 0 });
    }
  };
}

type ReadSecretOptions = {
  message: string;
  // How a person gets the secret, which a terminal shows before it asks.
  // What is wrong with the secret, if anything.
  validate?: (value: string | undefined) => string | undefined;
};

// Reads a secret a command needs, like a bot's token, which then shows neither on the screen nor in
// the shell's history. Undefined when the person stops at the question.
export type ReadSecret = (options: ReadSecretOptions) => Promise<string | undefined>;

type CreateSecretReaderOptions = { interactive: boolean; readStdin: () => Promise<string> };

function validateFilled(value: string | undefined) {
  return value?.trim() ? undefined : "Fill this in";
}

// A terminal asks for the secret without showing it, and otherwise it comes piped in.
export function createSecretReader({
  interactive,
  readStdin,
}: CreateSecretReaderOptions): ReadSecret {
  return async ({ message, validate = validateFilled }) => {
    if (interactive) {
      const answer = await password({ message, validate });

      return isCancel(answer) ? undefined : answer;
    }

    // What comes piped in ends with the newline that echo puts after it.
    const secret = (await readStdin()).replace(/\r?\n$/v, "");

    if (!secret.trim()) {
      throw new AppError({
        code: "invalid_input",
        message: `Not a terminal, so pipe it in: ${message}`,
      });
    }

    const problem = validate(secret);

    if (problem) throw new AppError({ code: "invalid_input", message: `${message}: ${problem}` });

    return secret;
  };
}

// Asks whether to go ahead with what cannot be undone, like removing an account.
export type Confirm = (question: string) => Promise<boolean>;

type CreateConfirmOptions = { interactive: boolean; yes: boolean };

// --yes answers every question, and outside a terminal only it can.
export function createConfirm({ interactive, yes }: CreateConfirmOptions): Confirm {
  return async (question) => {
    if (yes) return true;

    if (!interactive) {
      throw new AppError({
        code: "invalid_input",
        message: `${question} Give --yes to go ahead outside a terminal`,
      });
    }

    const answer = await confirm({ message: question, initialValue: false });

    return answer === true;
  };
}
