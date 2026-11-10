import { parseArgs } from "node:util";

import { password as askPassword, isCancel } from "@clack/prompts";

import type { ChannelDefinition } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import { createAccessCommands } from "../domains/access/commands";
import { createAddressCommands } from "../domains/addresses/commands";
import { createAgentCommands } from "../domains/agents/commands";
import { loadChannels } from "../domains/channels/load";
import { hashPassword, validatePassword } from "../domains/sign-in/password";
import { type ArtilCli, loginCommand } from "../platform/artil-cli";
import {
  type Config,
  newConfig,
  type Paths,
  pathsIn,
  readConfig,
  writeConfig,
} from "../platform/config";
import type { Tailscale } from "../platform/tailscale";
import { openCommandContext } from "./context";
import { startServer } from "./server";
import type { runSetup } from "./setup";

const usage = `artil-server: a self-hosted Artil Server

Usage:
  artil-server                                                    Start the server, setting it up first if it is new
  artil-server setup                                              Set up the accounts, channels, files and who reaches the server
  artil-server account create <name>                              Create an agent account
  artil-server account list                                       List the accounts
  artil-server account remove <name>                              Remove an account with its messages
  artil-server account token <name>                               Make a token, for a computer without a browser
  artil-server account revoke <name>                              Sign the account out of every client
  artil-server account connect <account> <channel> <credentials>  Connect an address of a channel to an account, with what the channel asks for
  artil-server account disconnect <account> <channel>             Disconnect the account's address of the channel
  artil-server access add <account> <channel> <sender>            Let someone wake the agent on the channel
  artil-server access remove <account> <channel> <sender>         Take them off the list
  artil-server access set <account> <channel> <who>               Choose who wakes the agent on the channel: anyone, team or list
  artil-server password                                           Set the password the sign-in page asks for

Options:
  --public          Open the server to the internet through Tailscale Funnel
  --local           Keep the server on this computer
  -h, --help        Show this help
  -v, --version     Show the version`;

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
  out: (line: string) => void;
};

function usageError(message: string) {
  return new AppError({ code: "invalid_input", message: `${message}\n\n${usage}` });
}

type ServeOptions = { paths: Paths; config: Config; environment: Environment };

async function serve({ paths, config, environment }: ServeOptions) {
  const { migrationsFolder, tailscale, out } = environment;

  if (config.public && !tailscale) {
    throw new AppError({
      code: "unavailable",
      message:
        "Public mode needs Tailscale: install it from https://tailscale.com/download, or start with --local",
    });
  }

  if (config.public && config.password === null) {
    throw new AppError({
      code: "invalid_input",
      message:
        "Public mode needs a password for the sign-in page: set one with artil-server password",
    });
  }

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

type SetPasswordOptions = { paths: Paths; config: Config; out: (line: string) => void };

async function setPassword({ paths, config, out }: SetPasswordOptions) {
  const newPassword = await askPassword({
    message: "A password the sign-in page asks for",
    validate: validatePassword,
  });

  if (isCancel(newPassword)) return;

  await writeConfig(paths, { ...config, password: await hashPassword(newPassword) });
  out("The sign-in page asks for it from now on.");
}

export async function runCli(environment: Environment) {
  const { values, positionals } = parseArgs({
    args: environment.argv,
    allowPositionals: true,
    options: {
      public: { type: "boolean" },
      local: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) return environment.out(usage);

  if (values.version) return environment.out(environment.version);

  const paths = pathsIn(environment.dataDir);
  const savedConfig = await readConfig(paths);

  // --public and --local change the mode the server starts in, and the config keeps it.
  async function applyFlags(config: Config) {
    const changed = {
      ...config,
      ...(values.public && { public: true }),
      ...(values.local && { public: false }),
    };

    if (changed.public !== config.public) await writeConfig(paths, changed);

    return changed;
  }

  const [command = "", subcommand = "", ...args] = positionals;

  const { migrationsFolder, tailscale, artil, runSetup, out, interactive, builtInChannels } =
    environment;

  const builtInKinds = builtInChannels.map(({ kind }) => kind);

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

    return serve({ paths, config: await applyFlags(config), environment });
  }

  if (command === "setup") {
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

  if (command === "password") return setPassword({ paths, config, out });

  const context = await openCommandContext({
    paths,
    config,
    builtInChannels,
    migrationsFolder,
    tailscale,
    out,
  });

  try {
    const run = new Map([
      ...createAgentCommands(context),
      ...createAddressCommands(context),
      ...createAccessCommands(context),
    ]).get(`${command} ${subcommand}`);

    if (!run) {
      throw usageError(`There is no command ${[command, subcommand].filter(Boolean).join(" ")}`);
    }

    if (args.length !== run.takes.length) {
      const expected = run.takes.map((name) => `<${name}>`).join(" ") || "no arguments";

      throw usageError(`This command takes ${expected}`);
    }

    await run.run(Object.fromEntries(run.takes.map((name, index) => [name, args[index] ?? ""])));
  } finally {
    context.close();
  }
}
