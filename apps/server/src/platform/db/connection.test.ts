import { Database as Sqlite } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
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

const decoder = new TextDecoder();

// A database as a server from before encryption left it: a bot's token, a message with its
// sender's name, its event and two files, all in plain text.
async function openedBeforeEncryption() {
  const path = join(await mkdtemp(join(tmpdir(), "artil-server-")), "artil.db");
  const sqlite = new Sqlite(path, { strict: true });

  migrate(drizzle({ client: sqlite }), { migrationsFolder });
  sqlite.run(`
    insert into agents (id, name, created_at) values ('a', 'Codex', 0);
    insert into addresses (id, agent_id, channel, value, credentials, created_at)
      values ('d', 'a', 'telegram', '@codex_bot', '123:token', 0);
    insert into messages (id, agent_id, address_id, channel, direction, counterpart,
      counterpart_name, "to", text, status, created_at)
      values ('m', 'a', 'd', 'telegram', 'inbound', '42', 'Ada', '[]', 'Deploy it', 'received', 0);
    insert into events (agent_id, type, channel, message_id, text, created_at)
      values ('a', 'message.received', 'telegram', 'm', 'Deploy it', 0);
    insert into files (id, agent_id, message_id, name, type, size, key, created_at)
      values ('f', 'a', 'm', 'report.txt', 'text/plain', 6, 'a/f', 0),
        ('g', 'a', 'm', 'notes.txt', 'text/plain', 5, 'a/g', 0);
  `);
  sqlite.close();

  return path;
}

function readFile(objects: Map<string, Uint8Array>, key: string) {
  return decoder.decode(decryptContent(objects.get(key) ?? new Uint8Array()));
}

test("encrypts what a database and its bucket from before encryption kept in plain text", async () => {
  const path = await openedBeforeEncryption();
  const { store, objects } = createMemoryStore();

  objects.set("a/f", new TextEncoder().encode("report"));
  objects.set("a/g", new TextEncoder().encode("notes"));

  const database = await openDatabase({ path, migrationsFolder, secret, store });

  const stored = database.db.$client
    .query<{ value: string }, []>(
      `select credentials as value from addresses union all select counterpart_name from messages
        union all select text from messages union all select text from events
        union all select name from files`,
    )
    .all()
    .map(({ value }) => value);

  const plaintexts = ["123:token", "Ada", "Deploy it", "report.txt", "notes.txt"];

  expect(stored).toHaveLength(6);
  expect(stored.filter((value) => plaintexts.includes(value))).toEqual([]);

  database.close();

  // It encrypts once: opened again, everything decrypts as it was.
  const { db, close } = await openDatabase({ path, migrationsFolder, secret, store });

  expect(db.select({ credentials: addresses.credentials }).from(addresses).all()).toEqual([
    { credentials: "123:token" },
  ]);
  expect(
    db.select({ text: messages.text, name: messages.counterpartName }).from(messages).all(),
  ).toEqual([{ text: "Deploy it", name: "Ada" }]);
  expect(db.select({ text: events.text }).from(events).all()).toEqual([{ text: "Deploy it" }]);
  expect(db.select({ name: files.name }).from(files).all()).toEqual([
    { name: "report.txt" },
    { name: "notes.txt" },
  ]);
  expect([readFile(objects, "a/f"), readFile(objects, "a/g")]).toEqual(["report", "notes"]);

  close();
});

test("picks up the bucket where it stopped, leaving the database as it was until then", async () => {
  const path = await openedBeforeEncryption();
  const { store, objects } = createMemoryStore();

  objects.set("a/f", new TextEncoder().encode("report"));

  await expect(openDatabase({ path, migrationsFolder, secret, store })).rejects.toThrow(
    "Could not encrypt the files in the bucket, which the server does once: No object a/g",
  );

  const untouched = new Sqlite(path, { readonly: true });

  expect(untouched.query("select text from messages").get()).toEqual({ text: "Deploy it" });
  untouched.close();

  objects.set("a/g", new TextEncoder().encode("notes"));

  const { db, close } = await openDatabase({ path, migrationsFolder, secret, store });

  expect(db.select({ text: messages.text }).from(messages).all()).toEqual([{ text: "Deploy it" }]);
  expect([readFile(objects, "a/f"), readFile(objects, "a/g")]).toEqual(["report", "notes"]);

  close();
});
