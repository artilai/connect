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
