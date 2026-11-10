import { expect, test } from "bun:test";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Config, newConfig, pathsIn, readConfig, writeConfig } from "../platform/config";
import { runCli } from "./cli";
import { channelModule, findFreePort, testChannelDefinition } from "./testing";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

// What each run of artil-server here has: the test channel, and an artil CLI that is installed.
const environment = {
  version: "0.0.0",
  builtInChannels: [testChannelDefinition],
  migrationsFolder,
  tailscale: undefined,
  artil: { installed: true, install: async () => {} },
};

async function refuseSetup(): Promise<Config> {
  throw new Error("A command ran the setup");
}

type PipeOptions = { dataDir: string; stdin: string };

// Runs artil-server the way a script does, with what it pipes in, like a bot's token.
async function pipeInto({ dataDir, stdin }: PipeOptions, ...argv: string[]) {
  const lines: string[] = [];

  await runCli({
    ...environment,
    argv,
    dataDir,
    interactive: false,
    runSetup: refuseSetup,
    waitForStop: async () => {},
    readStdin: async () => stdin,
    out: (line) => lines.push(line),
  });

  return lines.join("\n");
}

async function cli(dataDir: string, ...argv: string[]) {
  return pipeInto({ dataDir, stdin: "" }, ...argv);
}

type StartOptions = { dataDir: string; interactive: boolean };

// Starts the server, which stops as soon as it runs, and returns the config the setup began from
// each time it ran.
async function start({ dataDir, interactive }: StartOptions) {
  const setupConfigs: (Config | undefined)[] = [];

  await runCli({
    ...environment,
    argv: [],
    dataDir,
    interactive,
    runSetup: async ({ config }) => {
      setupConfigs.push(config);

      return { ...(config ?? newConfig({ channels: [] })), port: 0 };
    },
    waitForStop: async () => {},
    readStdin: async () => "",
    out: () => {},
  });

  return setupConfigs;
}

test("creates agents, lists them and makes a token to sign one in with", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  expect(await cli(dataDir, "account", "create", "Codex")).toContain(
    "artil auth login --base-url http://localhost:4747 --account 'Codex'",
  );

  expect(await cli(dataDir, "account", "list")).toMatch(/^Codex {2}\w{8} · not listening$/v);
  expect(await cli(dataDir, "account", "token", "codex", "macbook")).toMatch(
    /named macbook\..*\n.*artil auth login --base-url http:\/\/localhost:4747 --token artil_[\w\-]{43}$/v,
  );
});

test("signs an account out of one client by name, or out of all", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "account", "create", "Codex");
  await cli(dataDir, "account", "token", "Codex", "macbook");
  await cli(dataDir, "account", "token", "Codex", "server");

  await expect(cli(dataDir, "account", "revoke", "Codex", "MacBook")).rejects.toThrow(
    "Sign Codex out of MacBook? Give --yes to go ahead outside a terminal",
  );
  expect(await cli(dataDir, "account", "revoke", "Codex", "MacBook", "--yes")).toBe(
    "Signed Codex out of MacBook.",
  );
  await expect(cli(dataDir, "account", "revoke", "Codex", "macbook", "-y")).rejects.toThrow(
    "Codex has no client macbook; it has server",
  );
  await expect(cli(dataDir, "account", "token", "Codex", "All")).rejects.toThrow(
    "Name the token after where it signs in, like macbook, and not all",
  );

  await cli(dataDir, "account", "token", "Codex", "laptop");

  await expect(cli(dataDir, "account", "revoke", "Codex", "all")).rejects.toThrow(
    "Sign Codex out of all 2 of its clients? Give --yes",
  );
  expect(await cli(dataDir, "account", "revoke", "Codex", "all", "--yes")).toBe(
    "Signed Codex out of 2 clients.",
  );
  expect(await cli(dataDir, "account", "revoke", "Codex", "all")).toBe(
    "Codex is signed in to no client.",
  );
});

test("removes an account only once it is told yes", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "account", "create", "Codex");

  await expect(cli(dataDir, "account", "remove", "Codex")).rejects.toThrow(
    "Remove Codex with its messages and sign-ins? Give --yes to go ahead outside a terminal",
  );
  expect(await cli(dataDir, "account", "remove", "Codex", "--yes")).toBe(
    "Removed Codex, with its messages and sign-ins.",
  );
  expect(await cli(dataDir, "account", "list")).toBe(
    "No accounts yet. Create one with: artil-server account create <name>",
  );
});

test("renames an account, keeping its id", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "account", "create", "Codex");
  await cli(dataDir, "account", "create", "Claude");

  const [, id] = /^Codex {2}(\w{8})/v.exec(await cli(dataDir, "account", "list")) ?? [];

  expect(await cli(dataDir, "account", "rename", "codex", "Coder")).toBe("Renamed Codex to Coder.");
  expect(await cli(dataDir, "account", "list")).toContain(`Coder  ${id}`);
  expect(await cli(dataDir, "account", "rename", "coder", "CODER")).toBe("Renamed Coder to CODER.");
  await expect(cli(dataDir, "account", "rename", "coder", "claude")).rejects.toThrow(
    "There is already an agent claude",
  );
});

test("keeps its config and data where only its owner reads them", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "account", "list");

  const paths = pathsIn(dataDir);

  expect((await stat(paths.config)).mode & 0o777).toBe(0o600);
  expect((await stat(dataDir)).mode & 0o777).toBe(0o700);
  expect(await readConfig(paths)).toMatchObject({
    version: 1,
    port: 4747,
    public: false,
    password: null,
  });
});

test("says where the server is, whether it runs, and what keeps it from starting", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));
  const port = await findFreePort();

  await cli(dataDir, "set", "--port", String(port));

  expect(await cli(dataDir, "status")).toBe(
    [
      "Artil Server",
      `  Address       http://localhost:${port}, on this computer`,
      "  Running       no; start it with: artil-server",
      "  Files         off; turn them on with an S3 bucket in artil-server setup",
      "  Sign-in page  asks for no password",
      "  Channels      Test, Message URL",
      "  Accounts      none yet; create one with: artil-server account create <name>",
    ].join("\n"),
  );

  await cli(dataDir, "account", "create", "Codex");
  await pipeInto({ dataDir, stdin: "correct horse" }, "set", "--password");
  await cli(dataDir, "set", "--public");

  expect(await cli(dataDir, "status")).toContain(
    "  Accounts      Codex not listening\nProblems:\n  Public mode needs Tailscale",
  );
});

test("changes the server's mode, port and password with set", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  expect(await cli(dataDir, "set", "--port", "4848")).toBe(
    "The server listens on port 4848 from its next start.",
  );
  expect(await readConfig(pathsIn(dataDir))).toMatchObject({ port: 4848, public: false });
  await expect(cli(dataDir, "set", "--public")).rejects.toThrow(
    "Public mode needs a password for the sign-in page; give --password too",
  );
  await expect(pipeInto({ dataDir, stdin: "short\n" }, "set", "--password")).rejects.toThrow(
    "A password the sign-in page asks for: Use at least 8 characters",
  );
  expect(await pipeInto({ dataDir, stdin: "correct horse\n" }, "set", "--password")).toBe(
    "The sign-in page asks for the new password from now on.",
  );
  expect(await cli(dataDir, "set", "--public")).toBe(
    "The server opens to the internet through Tailscale Funnel from its next start.",
  );
  expect(await cli(dataDir, "set", "--public")).toBe("Nothing changed.");
  expect(await cli(dataDir, "set", "--local")).toBe(
    "The server stays on this computer from its next start.",
  );
  await expect(cli(dataDir, "set", "--public", "--local")).rejects.toThrow(
    "The server is either --public or --local",
  );
  await expect(cli(dataDir, "set", "--port", "seven")).rejects.toThrow("seven is not a port");
  await expect(cli(dataDir, "set", "--channel", "test")).rejects.toThrow(
    "This command takes no --channel",
  );
  await expect(cli(dataDir, "set")).rejects.toThrow(
    "artil-server set takes --public, --local, --port <port> or --password",
  );
});

test("sets the server up on a start in a terminal until it has an agent", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  expect(await start({ dataDir, interactive: true })).toEqual([undefined]);

  // A setup stopped before it made an agent has saved the config.
  await cli(dataDir, "account", "list");

  const paths = pathsIn(dataDir);
  const savedConfig = await readConfig(paths);

  if (!savedConfig) throw new Error("The first command did not write a config");

  const config = { ...savedConfig, port: await findFreePort() };

  await writeConfig(paths, config);

  expect(await start({ dataDir, interactive: false })).toEqual([]);
  expect(await start({ dataDir, interactive: true })).toEqual([config]);

  await cli(dataDir, "account", "create", "Codex");

  expect(await start({ dataDir, interactive: true })).toEqual([]);
});

test("adds a sender to an agent's list on the channel it names", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "account", "create", "Codex");

  expect(await cli(dataDir, "account", "allow", "Codex", "@AdaLovelace", "--channel", "test")).toBe(
    "@adalovelace now wakes Codex on Test.",
  );

  expect(await cli(dataDir, "account", "list")).toContain("woken on Test by @adalovelace");
  await expect(
    cli(dataDir, "account", "allow", "Codex", "not a sender!", "--channel", "test"),
  ).rejects.toThrow("not a sender! is not a name or @handle");
  await expect(cli(dataDir, "account", "allow", "Codex", "@AdaLovelace")).rejects.toThrow(
    "Codex is connected to no channel; name one with --channel",
  );
});

test("lets anyone, the team beside the list, or only the list wake an agent on a channel", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));
  const onTest = ["--channel", "test"];

  await cli(dataDir, "account", "create", "Codex");

  expect(await cli(dataDir, "account", "disallow", "Codex", "team", ...onTest)).toBe(
    "Only Codex's list now wakes it on Test.\nNo one is on it yet; add someone with: artil-server account allow 'Codex' <sender> --channel test",
  );
  expect(await cli(dataDir, "account", "list")).toContain("woken on Test by no one");

  await cli(dataDir, "account", "allow", "Codex", "@AdaLovelace", ...onTest);

  expect(await cli(dataDir, "account", "list")).toContain("woken on Test only by @adalovelace");
  expect(await cli(dataDir, "account", "allow", "Codex", "Anyone", ...onTest)).toBe(
    "Anyone now wakes Codex on Test.",
  );
  expect(await cli(dataDir, "account", "list")).toContain("woken on Test by anyone");
  expect(await cli(dataDir, "account", "allow", "Codex", "team", ...onTest)).toBe(
    "Anyone wakes Codex on Test.",
  );
  expect(await cli(dataDir, "account", "disallow", "Codex", "@AdaLovelace", ...onTest)).toBe(
    "@adalovelace is off Codex's list on Test.",
  );
  await cli(dataDir, "account", "allow", "Codex", "@AdaLovelace", ...onTest);
  expect(await cli(dataDir, "account", "disallow", "Codex", "anyone", ...onTest)).toBe(
    "The server's agents and Codex's list now wake it on Test.",
  );
  expect(await cli(dataDir, "account", "list")).toContain("woken on Test by @adalovelace");
  await expect(
    cli(dataDir, "account", "allow", "Codex", "anyone", "--channel", "url"),
  ).rejects.toThrow("Only the team or the senders you list can wake an agent at its Message URL");
});

test("lists the server's agents by name at the Message URL", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));
  const onUrl = ["--channel", "url"];

  await cli(dataDir, "account", "create", "Codex");
  await cli(dataDir, "account", "create", "Claude");
  await cli(dataDir, "account", "disallow", "Codex", "team", ...onUrl);

  expect(await cli(dataDir, "account", "allow", "Codex", "claude", ...onUrl)).toBe(
    "Claude now wakes Codex on Message URL.",
  );
  expect(await cli(dataDir, "account", "list")).toContain("woken on Message URL only by Claude");
  await expect(cli(dataDir, "account", "allow", "Codex", "nobody", ...onUrl)).rejects.toThrow(
    "nobody is not an agent of this server, by its name or id",
  );
});

test("names the channels it has when a command names one it does not", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "account", "create", "Codex");

  await expect(cli(dataDir, "account", "connect", "Codex", "discord")).rejects.toThrow(
    "This server has no discord channel; it has test, url",
  );
});

test("refuses a channel the config loads of a kind the server carries itself", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await writeFile(join(dataDir, "url-channel.ts"), channelModule("url"));
  await cli(dataDir, "account", "list");

  const paths = pathsIn(dataDir);
  const config = await readConfig(paths);

  if (!config) throw new Error("The first command did not write a config");

  await writeConfig(paths, { ...config, channels: ["./url-channel.ts"] });

  await expect(cli(dataDir, "account", "list")).rejects.toThrow(
    "The server has a url channel already",
  );
});

test("says how to use a command it does not know", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await expect(cli(dataDir, "account", "fly")).rejects.toThrow("There is no command account fly");
  await expect(cli(dataDir, "account", "create")).rejects.toThrow("This command takes <name>");
  await expect(cli(dataDir, "account", "list", "--channel", "test")).rejects.toThrow(
    "This command takes no --channel",
  );
  await expect(cli(dataDir, "--public")).rejects.toThrow("This command takes no --public");
  expect(await cli(dataDir, "--help")).toContain("artil-server account create <name>");
});

// Has the server load a channel of someone's own, Echo, beside the test channel, once a command
// wrote the config.
async function loadEchoChannel(dataDir: string) {
  await writeFile(join(dataDir, "echo-channel.ts"), channelModule("echo"));

  const paths = pathsIn(dataDir);
  const config = await readConfig(paths);

  if (!config) throw new Error("No command wrote a config yet");

  await writeConfig(paths, { ...config, channels: ["test", "./echo-channel.ts"] });
}

test("connects an account to a channel the config loads, and disconnects it", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "account", "create", "Codex");
  await loadEchoChannel(dataDir);

  await expect(cli(dataDir, "account", "connect", "Codex", "echo")).rejects.toThrow(
    "Not a terminal, so pipe it in: The address's credentials",
  );
  await expect(cli(dataDir, "account", "connect", "Codex", "url")).rejects.toThrow(
    "Every agent has its Message URL already; there is nothing to connect",
  );
  expect(
    await pipeInto({ dataDir, stdin: "hi\n" }, "account", "connect", "Codex", "echo"),
  ).toContain("echo:hi now reaches Codex on Echo.");
  expect(await cli(dataDir, "account", "list")).toContain("Echo echo:hi");
  expect(await cli(dataDir, "account", "allow", "Codex", "ada")).toBe(
    "ada now wakes Codex on Echo.",
  );
  await expect(cli(dataDir, "account", "disconnect", "Codex", "echo")).rejects.toThrow(
    "Disconnect echo:hi from Codex? Give --yes to go ahead outside a terminal",
  );
  expect(await cli(dataDir, "account", "disconnect", "Codex", "echo", "--yes")).toBe(
    "echo:hi no longer reaches Codex.",
  );
  expect(await cli(dataDir, "account", "disconnect", "Codex", "echo")).toBe(
    "Codex has no Echo address.",
  );
});

test("shows an account's addresses, clients and who wakes it", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "account", "create", "Codex");
  await loadEchoChannel(dataDir);
  await pipeInto({ dataDir, stdin: "hi" }, "account", "connect", "Codex", "echo");

  expect(await cli(dataDir, "account", "show", "Codex")).toContain(
    "Clients:\n  none yet; sign one in with: artil auth login --base-url http://localhost:4747 --account 'Codex'",
  );

  await cli(dataDir, "account", "token", "Codex", "macbook");
  await cli(dataDir, "account", "allow", "Codex", "ada");
  await cli(dataDir, "account", "allow", "Codex", "@AdaLovelace", "--channel", "test");

  expect(await cli(dataDir, "account", "show", "codex")).toMatch(
    /^Codex {2}(\w{8}) · not listening\nAddresses:\n {2}Message URL {2}http:\/\/localhost:4747\/a\/\1\n {2}Echo {9}echo:hi\nClients:\n {2}macbook {2}signed in \w{3} \d{1,2}, \d{4}\nWho wakes it:\n {2}Message URL {2}the server's agents\n {2}Test {9}the server's agents and @adalovelace\n {2}Echo {9}the server's agents and ada$/v,
  );
});
