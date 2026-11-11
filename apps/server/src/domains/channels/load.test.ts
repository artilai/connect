import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { channelModule, createTestChannel } from "../../app/testing";
import { loadChannels } from "./load";

const builtInChannels = [createTestChannel()];

async function dataFolder(files: Record<string, string> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "artil-server-channels-"));

  for (const [name, text] of Object.entries(files)) await writeFile(join(dataDir, name), text);

  return dataDir;
}

test("loads a built-in channel by its kind, and one of someone's own by its path", async () => {
  const dataDir = await dataFolder({ "echo-channel.ts": channelModule("echo") });

  const channels = await loadChannels({
    specifiers: ["test", "./echo-channel.ts"],
    dataDir,
    builtInChannels,
  });

  expect([...channels.keys()]).toEqual(["test", "echo"]);
});

test("says where it looked for a channel it cannot find", async () => {
  const dataDir = await dataFolder();

  await expect(
    loadChannels({ specifiers: ["@acme/discord-channel"], dataDir, builtInChannels }),
  ).rejects.toThrow(`There is no channel @acme/discord-channel from ${dataDir}`);
});

test("refuses a module that defines no channel", async () => {
  const dataDir = await dataFolder({ "notes.ts": "export const notes = [];\n" });

  await expect(
    loadChannels({ specifiers: ["./notes.ts"], dataDir, builtInChannels }),
  ).rejects.toThrow("./notes.ts does not export a channel named channel");
});

test("takes one channel of each kind, and leaves url to the Message URL", async () => {
  const dataDir = await dataFolder({
    "url-channel.ts": channelModule("url"),
  });

  await expect(
    loadChannels({ specifiers: ["test", "test"], dataDir, builtInChannels }),
  ).rejects.toThrow("The server has a test channel already");
  await expect(
    loadChannels({ specifiers: ["./url-channel.ts"], dataDir, builtInChannels }),
  ).rejects.toThrow("The server has a url channel already");
});

test("refuses a channel built for another version of the contract, saying which to update", async () => {
  const cases = [
    {
      kind: "older",
      // A channel from before the contract had versions, which counts as version 0.
      source: `export const channel = { kind: "older" };\n`,
      builtFor: 0,
      update: "update the older channel to one built for version 1",
    },
    {
      kind: "newer",
      source: channelModule("newer", 2),
      builtFor: 2,
      update: "update artil-server with: bun install --global @artil-ai/server",
    },
  ];

  for (const { kind, source, builtFor, update } of cases) {
    const dataDir = await dataFolder({ [`${kind}-channel.ts`]: source });

    await expect(
      loadChannels({ specifiers: [`./${kind}-channel.ts`], dataDir, builtInChannels }),
    ).rejects.toThrow(
      `The ${kind} channel is built for version ${builtFor} of the channel contract, and this server takes version 1; ${update}`,
    );
  }
});
