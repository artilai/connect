import { Database as Sqlite } from "bun:sqlite";

import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { AppError } from "@artil/errors";

import { initEncryption } from "./encryption";

type OpenDatabaseOptions = {
  // A file, or ":memory:" for a database that lasts as long as the process.
  path: string;
  migrationsFolder: string;
  // The server's secret, which makes the key the database and the bucket encrypt with.
  secret: string;
};

export function openDatabase({ path, migrationsFolder, secret }: OpenDatabaseOptions) {
  const sqlite = new Sqlite(path, { create: true, strict: true });

  // The server and the artil-connect commands write to the same file, one at a time.
  sqlite.run("pragma journal_mode = wal");
  sqlite.run("pragma busy_timeout = 5000");
  sqlite.run("pragma foreign_keys = on");

  // A server before 0.3.0 made other tables, with accounts as agents, by a first migration this one
  // no longer has: it says so rather than fail half way through migrating.
  const older = sqlite
    .query("select 1 from sqlite_master where type = 'table' and name = 'agents'")
    .get();

  if (older) {
    sqlite.close();

    throw new AppError({
      code: "unavailable",
      message: `${path} holds the data of an Artil Connect server before 0.3.0, which this one cannot read; move its folder aside to start anew`,
    });
  }

  const db = drizzle({ client: sqlite });

  initEncryption(secret);
  migrate(db, { migrationsFolder });

  return {
    db,
    // Changes whenever another connection, like an artil-connect command, commits a write.
    dataVersion: () =>
      sqlite.query<{ data_version: number }, []>("pragma data_version").get()?.data_version,
    close: () => sqlite.close(),
  };
}

export type Database = ReturnType<typeof openDatabase>["db"];
