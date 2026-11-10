import { Database as Sqlite } from "bun:sqlite";
import { dirname } from "node:path";

import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { AppError } from "@artil/errors";

import { decryptBytes, initEncryption } from "./encryption";

// The columns 0.2 began to encrypt, which a data folder from 0.1 holds as they came.
const encryptedColumns = [
  ["addresses", "credentials"],
  ["messages", "text"],
  ["messages", "counterpart_name"],
  ["files", "name"],
  ["events", "text"],
] as const;

// Data the key does not decrypt, from 0.1 or under another config.json's secret, stops the server
// and its commands before they start, rather than at the first message that holds it.
function checkDecrypts(sqlite: Sqlite, path: string) {
  for (const [table, column] of encryptedColumns) {
    const stored = sqlite
      .query<{ value: string }, []>(
        `select ${column} as value from ${table} where ${column} is not null limit 1`,
      )
      .get();

    if (!stored) continue;

    try {
      decryptBytes(Buffer.from(stored.value, "base64url"), `${table}.${column}`);
    } catch (cause) {
      throw new AppError({
        code: "unavailable",
        message: `The data in ${dirname(path)} does not decrypt with the secret in its config.json. Artil Server 0.1 did not encrypt its data, and this version cannot read it: move the folder aside and run artil-server again to start fresh. If config.json was replaced, put back the one the data was made with.`,
        cause,
      });
    }
  }
}

type OpenDatabaseOptions = {
  // A file, or ":memory:" for a database that lasts as long as the process.
  path: string;
  migrationsFolder: string;
  // The server's secret, which makes the key the database and the bucket encrypt with.
  secret: string;
};

export function openDatabase({ path, migrationsFolder, secret }: OpenDatabaseOptions) {
  const sqlite = new Sqlite(path, { create: true, strict: true });

  // The server and the artil-server commands write to the same file, one at a time.
  sqlite.run("pragma journal_mode = wal");
  sqlite.run("pragma busy_timeout = 5000");
  sqlite.run("pragma foreign_keys = on");

  const db = drizzle({ client: sqlite });

  initEncryption(secret);
  migrate(db, { migrationsFolder });

  try {
    checkDecrypts(sqlite, path);
  } catch (cause) {
    sqlite.close();

    throw cause;
  }

  return {
    db,
    // Changes whenever another connection, like an artil-server command, commits a write.
    dataVersion: () =>
      sqlite.query<{ data_version: number }, []>("pragma data_version").get()?.data_version,
    close: () => sqlite.close(),
  };
}

export type Database = ReturnType<typeof openDatabase>["db"];
