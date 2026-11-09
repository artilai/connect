import { Database as Sqlite } from "bun:sqlite";

import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { AppError, messageOf } from "@artil/errors";

import { decryptContent, encryptContent, type FileStore } from "../storage";
import { encryptText, initEncryption } from "./encryption";

// SQLite keeps a number in each database for the app that uses it: here, 1 once the database
// keeps encrypted what the schema encrypts, and 2 once its bucket does too.
const columnsEncrypted = 1;

const filesEncrypted = 2;

// The columns a database from before encryption kept in plain text. The list stays as it is: a
// column encrypted later never held plain text.
const plaintextColumns = [
  ["addresses", "credentials"],
  ["events", "text"],
  ["files", "name"],
  ["messages", "counterpart_name"],
  ["messages", "text"],
] as const;

function userVersion(sqlite: Sqlite) {
  return sqlite.query<{ user_version: number }, []>("pragma user_version").get()?.user_version ?? 0;
}

// Leaves WAL mode, which writes the WAL back into the file and which SQLite refuses while another
// connection has the database open. An in-memory database has no WAL to leave.
function leaveWal(sqlite: Sqlite) {
  try {
    sqlite.run("pragma journal_mode = delete");
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "SQLITE_BUSY")) throw cause;

    throw new AppError({
      code: "conflict",
      message:
        "Stop the running Artil Server first: the first run of 0.2 encrypts its data, which needs the database to itself",
    });
  }
}

// Encrypts the columns a database from before encryption kept in plain text, which SQL cannot,
// once it has left WAL mode. The file is then rebuilt, so the plain text does not stay in its free
// space.
function encryptColumns(sqlite: Sqlite) {
  if (userVersion(sqlite) >= columnsEncrypted) return;

  sqlite.transaction(() => {
    for (const [table, column] of plaintextColumns) {
      const rows = sqlite
        .query<{ row: number; value: string }, []>(
          `select rowid as row, "${column}" as value from "${table}" where "${column}" is not null`,
        )
        .all();

      const update = sqlite.query(`update "${table}" set "${column}" = ? where rowid = ?`);

      for (const { row, value } of rows) {
        update.run(encryptText(value, `${table}.${column}`), row);
      }
    }

    sqlite.run(`pragma user_version = ${columnsEncrypted}`);
  })();

  sqlite.run("vacuum");
  sqlite.run("pragma journal_mode = wal");
}

type EncryptFilesOptions = { sqlite: Sqlite; store: FileStore };

// Encrypts the bytes a bucket from before encryption kept in plain text, once the server has the
// bucket. It skips the bytes that decrypt already, so a run the bucket stops picks up where it
// left off.
async function encryptFiles({ sqlite, store }: EncryptFilesOptions) {
  if (userVersion(sqlite) >= filesEncrypted) return;

  // A file that has expired is never read again, and its bytes may be gone already.
  const storedFiles = sqlite
    .query<{ key: string; type: string }, [number]>(
      "select key, type from files where key is not null and (expires_at is null or expires_at > ?)",
    )
    .all(Date.now());

  try {
    for (const { key, type } of storedFiles) {
      const bytes = await store.read(key);

      if (!decrypts(bytes)) await store.put({ key, bytes: encryptContent(bytes), type });
    }
  } catch (cause) {
    throw new AppError({
      code: "unavailable",
      message: `Could not encrypt the files in the bucket, which the server does once: ${messageOf(cause, String(cause))}`,
    });
  }

  sqlite.run(`pragma user_version = ${filesEncrypted}`);
}

function decrypts(bytes: Uint8Array) {
  try {
    decryptContent(bytes);

    return true;
  } catch {
    return false;
  }
}

type OpenDatabaseOptions = {
  // A file, or ":memory:" for a database that lasts as long as the process.
  path: string;
  migrationsFolder: string;
  // The server's secret, which makes the key the database and the bucket encrypt with.
  secret: string;
  // Where files keep their bytes, which a database from before encryption kept in plain text.
  store: FileStore | undefined;
};

export async function openDatabase({ path, migrationsFolder, secret, store }: OpenDatabaseOptions) {
  const sqlite = new Sqlite(path, { create: true, strict: true });
  const db = drizzle({ client: sqlite });

  try {
    sqlite.run("pragma busy_timeout = 5000");
    sqlite.run("pragma foreign_keys = on");

    // The server and the artil-server commands write to the same file, one at a time. A server
    // from before encryption running on it would go on writing plain text, so a database from then
    // leaves WAL mode first, which proves it has no other connection.
    if (userVersion(sqlite) < columnsEncrypted) leaveWal(sqlite);
    else sqlite.run("pragma journal_mode = wal");

    initEncryption(secret);
    migrate(db, { migrationsFolder });
    encryptColumns(sqlite);

    if (store) await encryptFiles({ sqlite, store });
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

export type Database = Awaited<ReturnType<typeof openDatabase>>["db"];
