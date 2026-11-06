// A command of the artil-server command line: the arguments it takes in order, by the names it
// reads them under, and what it does with them.
export type Command = {
  takes: readonly string[];
  run: (values: Record<string, string>) => Promise<void> | void;
};

export function defineCommand<const Names extends readonly string[]>(
  takes: Names,
  run: (values: Record<Names[number], string>) => Promise<void> | void,
): Command {
  return { takes, run };
}
