import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadChannels } from "./load";

// A channel of someone's own, in a module beside the server's data.
const echoModule = `export const channel = {
  kind: "echo",
  create: () => ({
    kind: "echo",
    name: "Echo",
    recipients: "any name",
    send: async () => ({ externalId: "1" }),
  }),
};
`;

async function dataFolder(files: Record<string, string> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-channels-"));

  for (const [name, text] of Object.entries(files)) await writeFile(join(dataDir, name), text);

  return dataDir;
}

test("loads a built-in channel by its kind, and one of someone's own by its path", async () => {
  const dataDir = await dataFolder({ "echo-channel.ts": echoModule });

  const definitions = await loadChannels({
    specifiers: ["telegram", "./echo-channel.ts"],
    dataDir,
  });

  expect(definitions.map(({ kind }) => kind)).toEqual(["telegram", "echo"]);
});

test("says where it looked for a channel it cannot find", async () => {
  const dataDir = await dataFolder();

  await expect(loadChannels({ specifiers: ["@acme/discord-channel"], dataDir })).rejects.toThrow(
    `There is no channel @acme/discord-channel from ${dataDir}`,
  );
});

test("refuses a module that defines no channel", async () => {
  const dataDir = await dataFolder({ "notes.ts": "export const notes = [];\n" });

  await expect(loadChannels({ specifiers: ["./notes.ts"], dataDir })).rejects.toThrow(
    "./notes.ts does not export a channel definition named channel",
  );
});

test("takes one channel of each kind, and leaves url to the Message URL", async () => {
  const dataDir = await dataFolder({
    "url-channel.ts": echoModule.replaceAll("echo", "url"),
  });

  await expect(loadChannels({ specifiers: ["telegram", "telegram"], dataDir })).rejects.toThrow(
    "The server has a telegram channel already",
  );
  await expect(loadChannels({ specifiers: ["./url-channel.ts"], dataDir })).rejects.toThrow(
    "The server has a url channel already",
  );
});
