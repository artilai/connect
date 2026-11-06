import { parseArgs } from "node:util";

import { password as askPassword, isCancel } from "@clack/prompts";

import { AppError } from "@artil/errors";

import { type Config, newConfig, type Paths, pathsIn, readConfig, writeConfig } from "../config";
import { startServer } from "../server";
import { hashPassword, validatePassword } from "../sign-in/password";
import type { Tailscale } from "../tailscale";
import { addSender, removeSender } from "./access";
import {
  connectAddress,
  createAgent,
  disconnectAddress,
  issueToken,
  listAgents,
  removeAgent,
  revokeTokens,
} from "./agents";
import { type CommandContext, openCommandContext } from "./context";
import { runSetup } from "./setup";

const usage = `artil-server: a self-hosted Artil server

Usage:
  artil-server                                           Start the server, setting it up first if it is new
  artil-server setup                                     Set up the agents, channels, files and who reaches the server
  artil-server agent create <name>                       Create an agent
  artil-server agent list                                List the agents
  artil-server agent remove <name>                       Remove an agent with its messages
  artil-server agent token <name>                        Make a token, for a computer without a browser
  artil-server agent revoke <name>                       Sign the agent out of every client
  artil-server <channel> connect <agent> <credentials>   Connect an address of a channel to an agent, like a Telegram bot by its token
  artil-server <channel> disconnect <agent>              Disconnect the agent's address of the channel
  artil-server access add <agent> <channel> <sender>     Let someone wake the agent on the channel
  artil-server access remove <agent> <channel> <sender>  Take them off the list
  artil-server password                                  Set the password the sign-in page asks for

Options:
  --data <folder>   Where the server keeps its data (default: ~/.artil-server, or ARTIL_DATA)
  --port <port>     The local port (default: 4747)
  --public          Open the server to the internet through Tailscale Funnel
  --local           Keep the server on this computer
  -h, --help        Show this help
  -v, --version     Show the version`;

type Environment = {
  argv: string[];
  dataDir: string;
  version: string;
  interactive: boolean;
  migrationsFolder: string;
  tailscale: Tailscale | undefined;
  out: (line: string) => void;
};

function usageError(message: string) {
  return new AppError({ code: "invalid_input", message: `${message}\n\n${usage}` });
}

type Command = (context: CommandContext, args: readonly string[]) => Promise<void> | void;

// A command takes its arguments in order, each by the name it reads it under.
function defineCommand<const Names extends readonly string[]>(
  names: Names,
  run: (context: CommandContext, values: Record<Names[number], string>) => Promise<void> | void,
): Command {
  return (context, args) => {
    if (args.length !== names.length) {
      const expected = names.map((name) => `<${name}>`).join(" ") || "no arguments";

      throw usageError(`This command takes ${expected}`);
    }

    // SAFETY: there is one argument for each name, checked just above.
    const values = Object.fromEntries(names.map((name, index) => [name, args[index]])) as Record<
      Names[number],
      string
    >;

    return run(context, values);
  };
}

const commands = new Map<string, Command>([
  ["agent create", defineCommand(["name"], (context, { name }) => createAgent(context, name))],
  ["agent list", defineCommand([], (context) => listAgents(context))],
  ["agent remove", defineCommand(["name"], (context, { name }) => removeAgent(context, name))],
  ["agent token", defineCommand(["name"], (context, { name }) => issueToken(context, name))],
  ["agent revoke", defineCommand(["name"], (context, { name }) => revokeTokens(context, name))],
  [
    "access add",
    defineCommand(["agent", "channel", "sender"], (context, { agent, channel, sender }) =>
      addSender({ context, name: agent, kind: channel, sender }),
    ),
  ],
  [
    "access remove",
    defineCommand(["agent", "channel", "sender"], (context, { agent, channel, sender }) =>
      removeSender({ context, name: agent, kind: channel, sender }),
    ),
  ],
]);

// A channel's commands go by its kind, like artil-server telegram connect.
const channelCommands = new Map<string, (kind: string) => Command>([
  [
    "connect",
    (kind) =>
      defineCommand(["agent", "credentials"], (context, { agent, credentials }) =>
        connectAddress({ context, kind, name: agent, credentials }),
      ),
  ],
  [
    "disconnect",
    (kind) =>
      defineCommand(["agent"], (context, { agent }) =>
        disconnectAddress({ context, kind, name: agent }),
      ),
  ],
]);

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
    password: async () => (await readConfig(paths))?.password ?? null,
    log: out,
  });

  out(
    `Artil server is at ${server.baseUrl}${config.public ? " (public, through Tailscale Funnel)" : ""}.`,
  );
  out(`Sign an agent in with: ARTIL_BASE_URL=${server.baseUrl} artil auth login`);
  out(`MCP clients connect to ${server.baseUrl}/mcp`);

  const { promise, resolve } = Promise.withResolvers<void>();

  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);

  await promise;
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
      data: { type: "string" },
      port: { type: "string" },
      public: { type: "boolean" },
      local: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) return environment.out(usage);

  if (values.version) return environment.out(environment.version);

  const paths = pathsIn(values.data ?? environment.dataDir);
  const savedConfig = await readConfig(paths);
  const port = values.port === undefined ? undefined : Number(values.port);

  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65_536)) {
    throw usageError(`${values.port} is not a port`);
  }

  // Flags change the config the server starts with, and it keeps them.
  async function applyFlags(config: Config) {
    const changed = {
      ...config,
      ...(port !== undefined && { port }),
      ...(values.public && { public: true }),
      ...(values.local && { public: false }),
    };

    if (changed.port !== config.port || changed.public !== config.public)
      await writeConfig(paths, changed);

    return changed;
  }

  const [command = "", subcommand = "", ...args] = positionals;
  const { migrationsFolder, tailscale, out, interactive } = environment;

  if (command === "" || command === "start") {
    const config =
      savedConfig ??
      (interactive
        ? await runSetup({ paths, config: undefined, migrationsFolder, tailscale, out })
        : newConfig());

    if (!savedConfig && !interactive) await writeConfig(paths, config);

    return serve({ paths, config: await applyFlags(config), environment });
  }

  if (command === "setup") {
    await runSetup({ paths, config: savedConfig, migrationsFolder, tailscale, out });

    return;
  }

  const config = savedConfig ?? newConfig();

  if (!savedConfig) await writeConfig(paths, config);

  if (command === "password") return setPassword({ paths, config, out });

  const run =
    commands.get(`${command} ${subcommand}`) ?? channelCommands.get(subcommand)?.(command);

  if (!run)
    throw usageError(`There is no command ${[command, subcommand].filter(Boolean).join(" ")}`);

  const context = openCommandContext({
    paths,
    config,
    migrationsFolder,
    tailscale,
    out,
  });

  try {
    await run(context, args);
  } finally {
    context.close();
  }
}
