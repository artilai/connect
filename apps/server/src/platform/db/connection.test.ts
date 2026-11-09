import { Database as Sqlite } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { createMemoryStore, decryptContent } from "../storage";
import { openDatabase } from "./connection";
import { addresses, events, files, messages } from "./schema";

const migrationsFolder = fileURLToPath(new URL("../../../migrations", import.meta.url));

const secret = "secret-of-the-test-server-of-at-least-32-chars";

const encoder = new TextEncoder();

const decoder = new TextDecoder();

const plaintexts = ["123456:bot-token", "Ada Lovelace", "Deploy the release", "report.txt"];

// A database as a server from before encryption left it: a bot's token, a message with its
// sender's name, its event and two files, all in plain text. It stays out of WAL mode, since the
// statements Drizzle's migrator leaves keep a closed connection holding the WAL until they are
// collected, as a server's process that has exited does not.
async function openedBeforeEncryption() {
  const path = join(await mkdtemp(join(tmpdir(), "artil-server-")), "artil.db");
  const sqlite = new Sqlite(path, { strict: true });

  migrate(drizzle({ client: sqlite }), { migrationsFolder });
  sqlite.run(`
    insert into agents (id, name, created_at) values ('a', 'Codex', 0);
    insert into addresses (id, agent_id, channel, value, credentials, created_at)
      values ('d', 'a', 'telegram', '@codex_bot', '123456:bot-token', 0);
    insert into messages (id, agent_id, address_id, channel, direction, counterpart,
      counterpart_name, "to", text, status, created_at)
      values ('m', 'a', 'd', 'telegram', 'inbound', '42', 'Ada Lovelace', '[]',
        'Deploy the release', 'received', 0);
    insert into events (agent_id, type, channel, message_id, text, created_at)
      values ('a', 'message.received', 'telegram', 'm', 'Deploy the release', 0);
    insert into files (id, agent_id, message_id, name, type, size, key, created_at)
      values ('f', 'a', 'm', 'report.txt', 'text/plain', 6, 'a/f', 0),
        ('g', 'a', 'm', 'notes.txt', 'text/plain', 5, 'a/g', 0);
  `);
  sqlite.close();

  return path;
}

// What the database's files hold on disk, its WAL among them.
async function bytesOnDisk(path: string) {
  const wal = await readFile(`${path}-wal`).catch(() => Buffer.alloc(0));

  return Buffer.concat([await readFile(path), wal]);
}

function readObject(objects: Map<string, Uint8Array>, key: string) {
  return decoder.decode(decryptContent(objects.get(key) ?? new Uint8Array()));
}

test("encrypts what a database and its bucket from before encryption kept in plain text", async () => {
  const path = await openedBeforeEncryption();
  const { store, objects } = createMemoryStore();

  objects.set("a/f", encoder.encode("report"));
  objects.set("a/g", encoder.encode("notes"));

  const database = await openDatabase({ path, migrationsFolder, secret, store });
  const onDisk = await bytesOnDisk(path);

  expect(plaintexts.filter((plaintext) => onDisk.includes(plaintext))).toEqual([]);

  database.close();

  // It encrypts once: opened again, everything decrypts as it was.
  const { db, close } = await openDatabase({ path, migrationsFolder, secret, store });

  expect(db.select({ credentials: addresses.credentials }).from(addresses).all()).toEqual([
    { credentials: "123456:bot-token" },
  ]);
  expect(
    db.select({ text: messages.text, name: messages.counterpartName }).from(messages).all(),
  ).toEqual([{ text: "Deploy the release", name: "Ada Lovelace" }]);
  expect(db.select({ text: events.text }).from(events).all()).toEqual([
    { text: "Deploy the release" },
  ]);
  expect(db.select({ name: files.name }).from(files).all()).toEqual([
    { name: "report.txt" },
    { name: "notes.txt" },
  ]);
  expect([readObject(objects, "a/f"), readObject(objects, "a/g")]).toEqual(["report", "notes"]);

  close();
});

test("encrypts the bucket's files once it reaches them, picking up where it stopped", async () => {
  const path = await openedBeforeEncryption();
  const { store, objects } = createMemoryStore();

  // A server without its bucket encrypts the database, and leaves the files for later.
  (await openDatabase({ path, migrationsFolder, secret, store: undefined })).close();

  objects.set("a/f", encoder.encode("report"));

  await expect(openDatabase({ path, migrationsFolder, secret, store })).rejects.toThrow(
    "Could not encrypt the files in the bucket, which the server does once: No object a/g",
  );

  objects.set("a/g", encoder.encode("notes"));

  const { db, close } = await openDatabase({ path, migrationsFolder, secret, store });

  expect(db.select({ text: messages.text }).from(messages).all()).toEqual([
    { text: "Deploy the release" },
  ]);
  expect([readObject(objects, "a/f"), readObject(objects, "a/g")]).toEqual(["report", "notes"]);

  close();
});

test("waits for a server from before to let go of the database before encrypting it", async () => {
  const path = await openedBeforeEncryption();
  const earlierServer = new Sqlite(path);
  const message = earlierServer.query("select text from messages");

  earlierServer.run("pragma journal_mode = wal");
  message.get();

  await expect(openDatabase({ path, migrationsFolder, secret, store: undefined })).rejects.toThrow(
    "Stop the running Artil Server first",
  );
  expect(message.get()).toEqual({ text: "Deploy the release" });

  earlierServer.close();

  const { db, close } = await openDatabase({ path, migrationsFolder, secret, store: undefined });

  expect(db.select({ text: messages.text }).from(messages).all()).toEqual([
    { text: "Deploy the release" },
  ]);

  close();
});
