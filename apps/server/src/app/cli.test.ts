import { expect, test } from "bun:test";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { pathsIn, readConfig, writeConfig } from "../platform/config";
import { runCli } from "./cli";
import { channelModule, testChannelDefinition } from "./testing";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

async function cli(dataDir: string, ...argv: string[]) {
  const lines: string[] = [];

  await runCli({
    argv,
    dataDir,
    version: "0.0.0",
    interactive: false,
    builtInChannels: [testChannelDefinition],
    migrationsFolder,
    tailscale: undefined,
    artil: { installed: true, install: async () => {} },
    out: (line) => lines.push(line),
  });

  return lines.join("\n");
}

test("creates agents, lists them and makes a token to sign one in with", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  expect(await cli(dataDir, "account", "create", "Codex")).toContain(
    "artil auth login --base-url http://localhost:4747 --account 'Codex'",
  );

  expect(await cli(dataDir, "account", "list")).toMatch(/^Codex {2}\w{8} · not listening$/v);
  expect(await cli(dataDir, "account", "token", "codex")).toMatch(
    /artil auth login --base-url http:\/\/localhost:4747 --token artil_[\w\-]{43}$/v,
  );
  expect(await cli(dataDir, "account", "revoke", "codex")).toBe("Signed Codex out of 1 client.");
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

test("adds a sender to an agent's list on a channel", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "account", "create", "Codex");

  expect(await cli(dataDir, "access", "add", "Codex", "test", "@AdaLovelace")).toBe(
    "@adalovelace now wakes Codex on Test.",
  );

  expect(await cli(dataDir, "account", "list")).toContain("woken on Test by @adalovelace");
  await expect(cli(dataDir, "access", "add", "Codex", "test", "not a sender!")).rejects.toThrow(
    "not a sender! is not a name or @handle",
  );
});

test("lets anyone, the team beside the list, or only the list wake an agent on a channel", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "account", "create", "Codex");

  expect(await cli(dataDir, "access", "set", "Codex", "test", "list")).toBe(
    "Only Codex's list now wakes it on Test.\nNo one is on it yet; add someone with: artil-server access add 'Codex' test <sender>",
  );
  expect(await cli(dataDir, "account", "list")).toContain("woken on Test by no one");

  await cli(dataDir, "access", "add", "Codex", "test", "@AdaLovelace");

  expect(await cli(dataDir, "account", "list")).toContain("woken on Test only by @adalovelace");
  expect(await cli(dataDir, "access", "set", "Codex", "test", "Anyone")).toBe(
    "Anyone now wakes Codex on Test.",
  );
  expect(await cli(dataDir, "account", "list")).toContain("woken on Test by anyone");
  expect(await cli(dataDir, "access", "set", "Codex", "test", "team")).toBe(
    "The server's agents and Codex's list now wake it on Test.",
  );
  expect(await cli(dataDir, "account", "list")).toContain("woken on Test by @adalovelace");
  await expect(cli(dataDir, "access", "set", "Codex", "url", "anyone")).rejects.toThrow(
    "Only the team or the senders you list can wake an agent at its Message URL",
  );
  await expect(cli(dataDir, "access", "set", "Codex", "test", "everyone")).rejects.toThrow(
    "everyone is not anyone, team or list",
  );
});

test("names the channels it has when a command names one it does not", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "account", "create", "Codex");

  await expect(cli(dataDir, "discord", "connect", "Codex", "token")).rejects.toThrow(
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
  expect(await cli(dataDir, "--help")).toContain("artil-server account create <name>");
});

test("connects an address of a channel the config loads", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await writeFile(join(dataDir, "echo-channel.ts"), channelModule("echo"));

  await cli(dataDir, "account", "create", "Codex");

  const paths = pathsIn(dataDir);
  const config = await readConfig(paths);

  if (!config) throw new Error("The first command did not write a config");

  await writeConfig(paths, { ...config, channels: ["test", "./echo-channel.ts"] });

  expect(await cli(dataDir, "echo", "connect", "Codex", "hi")).toContain(
    "echo:hi now reaches Codex on Echo.",
  );
  expect(await cli(dataDir, "account", "list")).toContain("Echo echo:hi");
});
