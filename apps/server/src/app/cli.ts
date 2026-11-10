import { parseArgs } from "node:util";

import type { ChannelDefinition } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import { createAccessCommands } from "../domains/access/commands";
import { createAddressCommands } from "../domains/addresses/commands";
import { createAgentCommands } from "../domains/agents/commands";
import { loadChannels } from "../domains/channels/load";
import { type ArtilCli, loginCommand } from "../platform/artil-cli";
import { type Command, createConfirm, createSecretReader } from "../platform/commands";
import {
  type Config,
  newConfig,
  type Paths,
  pathsIn,
  readConfig,
  writeConfig,
} from "../platform/config";
import type { Tailscale } from "../platform/tailscale";
import { createArgumentChoosers } from "./arguments";
import { type CommandContext, openCommandContext } from "./context";
import { startServer } from "./server";
import { changeSettings, settingFlags } from "./settings";
import type { runSetup } from "./setup";
import { findStartProblems, showStatus } from "./status";

const usage = `artil-server: a self-hosted Artil Server

Usage:
  artil-server                                         Start the server, setting it up first if it is new
  artil-server setup                                   Set up the accounts, channels, files and who reaches the server
  artil-server status                                  Show where the server is, whether it runs, and what keeps it from starting
  artil-server set --public                            Open the server to the internet through Tailscale Funnel from its next start
  artil-server set --local                             Keep the server on this computer from its next start
  artil-server set --port <port>                       Listen on another port from the server's next start
  artil-server set --password                          Set the password the sign-in page asks for, typed or piped in
  artil-server account create <name>                   Create an agent account
  artil-server account list                            List the accounts
  artil-server account show <account>                  Show an account's addresses, clients and who wakes it
  artil-server account rename <account> <name>         Give an account another name
  artil-server account remove <account>                Remove an account with its messages
  artil-server account token <account> <name>          Make a token by a name of its own, for a computer without a browser
  artil-server account revoke <account> <client>       Sign the account out of a client by its name, or out of all
  artil-server account connect <account> <channel>     Connect an address of a channel to an account, with what the channel asks for, typed or piped in
  artil-server account disconnect <account> <channel>  Disconnect the account's address of the channel
  artil-server account allow <account> <who>           Let a sender, the team or anyone wake the account's agent
  artil-server account disallow <account> <who>        Stop a sender, the team or anyone from waking it

Options:
  --channel <channel>  The channel allow and disallow mean, by default the one the account is connected to
  -y, --yes            Answer yes to what remove, disconnect and revoke ask
  -h, --help           Show this help
  -v, --version        Show the version

In a terminal, a command offers the account, channel, client or sender it is not given.`;

type Environment = {
  argv: string[];
  dataDir: string;
  version: string;
  interactive: boolean;
  // The channels the server comes with; the config loads others.
  builtInChannels: readonly ChannelDefinition[];
  migrationsFolder: string;
  tailscale: Tailscale | undefined;
  // The artil CLI on this computer, which the setup offers when it is missing.
  artil: ArtilCli;
  // Asks for the agents, their channels, files and mode in the terminal, and saves the config.
  runSetup: typeof runSetup;
  // Resolves when the server should stop, like on Ctrl-C.
  waitForStop: () => Promise<void>;
  // What is piped in, like a bot's token, which a command reads outside a terminal.
  readStdin: () => Promise<string>;
  out: (line: string) => void;
};

function usageError(message: string) {
  return new AppError({ code: "invalid_input", message: `${message}\n\n${usage}` });
}

type ServeOptions = { paths: Paths; config: Config; environment: Environment };

async function serve({ paths, config, environment }: ServeOptions) {
  const { migrationsFolder, tailscale, out } = environment;
  const [problem] = findStartProblems({ config, tailscale });

  if (problem) throw new AppError({ code: "invalid_input", message: problem });

  const server = await startServer({
    config,
    databasePath: paths.database,
    migrationsFolder,
    tailscale,
    channels: await loadChannels({
      specifiers: config.channels,
      dataDir: paths.dataDir,
      builtInChannels: environment.builtInChannels,
    }),
    password: async () => (await readConfig(paths))?.password ?? null,
    log: out,
  });

  out(
    `Artil Server is at ${server.baseUrl}${config.public ? " (public, through Tailscale Funnel)" : ""}.`,
  );
  out(`Sign an agent in with: ${loginCommand(server.baseUrl)}`);
  out(`MCP clients connect to ${server.baseUrl}/mcp`);

  await environment.waitForStop();
  out("Stopping");
  await server.stop();
}

export async function runCli(environment: Environment) {
  const { values, positionals } = parseArgs({
    args: environment.argv,
    allowPositionals: true,
    options: {
      channel: { type: "string" },
      public: { type: "boolean" },
      local: { type: "boolean" },
      port: { type: "string" },
      password: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) return environment.out(usage);

  if (values.version) return environment.out(environment.version);

  const paths = pathsIn(environment.dataDir);
  const savedConfig = await readConfig(paths);

  // Refuses a flag the command does not read, like --public beside account list.
  // --yes answers whatever a command asks, so every command takes it.
  function checkFlags(accepted: readonly string[]) {
    const unknownFlag = Object.keys(values).find(
      (flag) => flag !== "yes" && !accepted.includes(flag),
    );

    if (unknownFlag) throw usageError(`This command takes no --${unknownFlag}`);
  }

  const [command = "", subcommand = "", ...args] = positionals;

  const { migrationsFolder, tailscale, artil, runSetup, out, interactive, builtInChannels } =
    environment;

  const builtInKinds = builtInChannels.map(({ kind }) => kind);
  const readSecret = createSecretReader({ interactive, readStdin: environment.readStdin });
  const confirm = createConfirm({ interactive, yes: values.yes === true });

  type ReadArgumentsOptions = { run: Command; context: CommandContext };

  // The command's arguments by name, with what a terminal offers for any the command line left
  // out; undefined when the person stops.
  async function readArguments({ run, context }: ReadArgumentsOptions) {
    const expected = run.takes.map((name) => `<${name}>`).join(" ") || "no arguments";

    if (args.length > run.takes.length) throw usageError(`This command takes ${expected}`);

    const given = new Map(args.map((value, index) => [run.takes[index] ?? "", value]));
    const choosers = createArgumentChoosers(context);

    for (const name of run.takes.slice(args.length)) {
      const chooser = choosers.get(name);

      if (!interactive || !chooser) throw usageError(`This command takes ${expected}`);

      const choice = await chooser({ given, channel: values.channel });

      if (choice === undefined) return undefined;

      given.set(name, choice);
    }

    return given;
  }

  // A server is new until it has an agent, so a setup stopped before it made one runs again.
  async function hasAgents(config: Config) {
    const context = await openCommandContext({
      paths,
      config,
      builtInChannels,
      migrationsFolder,
      tailscale,
      out,
    });

    try {
      return context.agents.list().length > 0;
    } finally {
      context.close();
    }
  }

  if (command === "" || command === "start") {
    checkFlags([]);

    const config =
      interactive && (!savedConfig || !(await hasAgents(savedConfig)))
        ? await runSetup({
            paths,
            config: savedConfig,
            builtInChannels,
            artil,
            migrationsFolder,
            tailscale,
            out,
          })
        : (savedConfig ?? newConfig({ channels: builtInKinds }));

    if (!savedConfig && !interactive) await writeConfig(paths, config);

    return serve({ paths, config, environment });
  }

  if (command === "setup") {
    checkFlags([]);

    await runSetup({
      paths,
      config: savedConfig,
      builtInChannels,
      artil,
      migrationsFolder,
      tailscale,
      out,
    });

    return;
  }

  const config = savedConfig ?? newConfig({ channels: builtInKinds });

  if (!savedConfig) await writeConfig(paths, config);

  if (command === "set") {
    checkFlags(settingFlags);

    if (Object.keys(values).length === 0) {
      throw usageError("artil-server set takes --public, --local, --port <port> or --password");
    }

    const change = {
      public: values.public === true,
      local: values.local === true,
      port: values.port,
      password: values.password === true,
    };

    return changeSettings({ paths, config, change, readSecret, out });
  }

  const context = await openCommandContext({
    paths,
    config,
    builtInChannels,
    migrationsFolder,
    tailscale,
    out,
  });

  try {
    if (command === "status") {
      checkFlags([]);

      return await showStatus({ config, tailscale, context, out });
    }

    const run = new Map([
      ...createAgentCommands({ ...context, confirm }),
      ...createAddressCommands({ ...context, readSecret, confirm }),
      ...createAccessCommands(context),
    ]).get(`${command} ${subcommand}`);

    if (!run) {
      throw usageError(`There is no command ${[command, subcommand].filter(Boolean).join(" ")}`);
    }

    checkFlags(run.flags);

    const given = await readArguments({ run, context });

    if (!given) return;

    await run.run({
      ...Object.fromEntries(given),
      ...(values.channel !== undefined && { channel: values.channel }),
    });
  } finally {
    context.close();
  }
}
