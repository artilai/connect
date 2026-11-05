import { expect, test } from "bun:test";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { pathsIn, readConfig } from "../config";
import { runCli } from "./cli";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

async function cli(dataDir: string, ...argv: string[]) {
  const lines: string[] = [];

  await runCli({
    argv,
    dataDir,
    version: "0.0.0",
    interactive: false,
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

test("adds a Telegram sender to an agent's list", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await cli(dataDir, "agent", "create", "Codex");

  expect(await cli(dataDir, "access", "add", "Codex", "@AdaLovelace")).toBe(
    "@adalovelace now wakes Codex on Telegram.",
  );

  expect(await cli(dataDir, "agent", "list")).toContain("woken by @adalovelace");
  await expect(cli(dataDir, "access", "add", "Codex", "not a sender!")).rejects.toThrow(
    "is not a Telegram",
  );
});

test("says how to use a command it does not know", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-"));

  await expect(cli(dataDir, "agent", "fly")).rejects.toThrow("There is no command agent fly");
  await expect(cli(dataDir, "agent", "create")).rejects.toThrow("This command takes <name>");
  expect(await cli(dataDir, "--help")).toContain("artil-server agent create <name>");
});
