import { isCancel, note, password } from "@clack/prompts";

import { AppError } from "@artil/errors";

// A command of the artil-server command line: the arguments it takes in order and the flags it
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

type ReadSecretOptions = {
  message: string;
  // How a person gets the secret, which a terminal shows before it asks.
  guide?: string;
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
  return async ({ message, guide, validate = validateFilled }) => {
    if (interactive) {
      if (guide) note(guide);

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
