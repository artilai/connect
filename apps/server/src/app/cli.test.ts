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
    out: (line) => lines.push(line),
  });

  return lines.join("\n");
}

test("creates agents, lists them and makes a token to sign one in with", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  expect(await cli(dataDir, "agent", "create", "Codex")).toContain(
    "ARTIL_BASE_URL=http://localhost:4747 artil auth login --account 'Codex'",
  );

  expect(await cli(dataDir, "agent", "list")).toMatch(/^Codex {2}\w{8} · not listening$/v);
  expect(await cli(dataDir, "agent", "token", "codex")).toMatch(
    /artil auth login --token artil_[\w\-]{43}$/v,
  );
  expect(await cli(dataDir, "agent", "revoke", "codex")).toBe("Signed Codex out of 1 client.");
});

test("keeps its config and data where only its owner reads them", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "agent", "list");

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

  await cli(dataDir, "agent", "create", "Codex");

  expect(await cli(dataDir, "access", "add", "Codex", "test", "@AdaLovelace")).toBe(
    "@adalovelace now wakes Codex on Test.",
  );

  expect(await cli(dataDir, "agent", "list")).toContain("woken on Test by @adalovelace");
  await expect(cli(dataDir, "access", "add", "Codex", "test", "not a sender!")).rejects.toThrow(
    "not a sender! is not a name or @handle",
  );
});

test("names the channels it has when a command names one it does not", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "agent", "create", "Codex");

  await expect(cli(dataDir, "discord", "connect", "Codex", "token")).rejects.toThrow(
    "This server has no discord channel; it has test, url",
  );
});

test("says how to use a command it does not know", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await expect(cli(dataDir, "agent", "fly")).rejects.toThrow("There is no command agent fly");
  await expect(cli(dataDir, "agent", "create")).rejects.toThrow("This command takes <name>");
  expect(await cli(dataDir, "--help")).toContain("artil-server agent create <name>");
});

test("connects an address of a channel the config loads", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await writeFile(join(dataDir, "echo-channel.ts"), channelModule("echo"));

  await cli(dataDir, "agent", "create", "Codex");

  const paths = pathsIn(dataDir);
  const config = await readConfig(paths);

  if (!config) throw new Error("The first command did not write a config");

  await writeConfig(paths, { ...config, channels: ["test", "./echo-channel.ts"] });

  expect(await cli(dataDir, "echo", "connect", "Codex", "hi")).toContain(
    "echo:hi now reaches Codex on Echo.",
  );
  expect(await cli(dataDir, "agent", "list")).toContain("Echo echo:hi");
});
