import { Database as Sqlite } from "bun:sqlite";

import { and, asc, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

import { AppError } from "@artil/errors";

import { eqIfGiven } from "../../platform/db/conditions";
import type { Database } from "../../platform/db/connection";
import { messages } from "../../platform/db/schema";
import type { MessageFilter, MessageRow } from "./schema";

export type SearchQuery = Omit<MessageFilter, "before" | "limit"> & {
  words: readonly string[];
  limit: number;
};

const shortestWord = 2;

// Each word widens the match, so a long query would hold up the server.
const mostWords = 10;

const indexedColumns = {
  id: messages.id,
  accountId: messages.accountId,
  channel: messages.channel,
  direction: messages.direction,
  counterpart: messages.counterpart,
  subject: messages.subject,
  text: messages.text,
};

type IndexedMessage = Pick<MessageRow, keyof typeof indexedColumns>;

// What the index keeps of a message, in an FTS5 table that searches only its words.
const entries = sqliteTable("entries", {
  id: text("id").notNull(),
  accountId: text("account_id").notNull(),
  channel: text("channel").notNull(),
  direction: text("direction").notNull(),
  counterpart: text("counterpart").notNull(),
  words: text("words").notNull(),
});

// An insert of many entries at once is faster than one each, within SQLite's limit on values.
const entriesPerInsert = 1000;

// Folds case and drops the marks on letters, so ё matches е.
function folded(value: string) {
  return value.normalize("NFD").replaceAll(/\p{M}/gv, "").toLowerCase();
}

export function readSearchWords(search: string) {
  const words = new Set(
    folded(search)
      .split(/[^\p{L}\p{N}]+/v)
      .filter((word) => word.length >= shortestWord),
  );

  if (words.size === 0) {
    throw new AppError({
      code: "invalid_input",
      message: `Search for words of ${shortestWord} letters or more`,
    });
  }

  if (words.size > mostWords) {
    throw new AppError({
      code: "invalid_input",
      message: `Search for at most ${mostWords} words`,
    });
  }

  return [...words];
}

function toEntry(message: IndexedMessage) {
  const { id, accountId, channel, direction, counterpart, subject } = message;

  return {
    id,
    accountId,
    channel,
    direction,
    counterpart,
    words: folded(`${subject ?? ""}\n${message.text}`),
  };
}

// Any of the words, each as the start of a word. They hold only letters and digits, so they need no
// escaping.
function matchesAny(words: readonly string[]) {
  return sql`${entries} match ${words.map((word) => `"${word}"*`).join(" OR ")}`;
}

function createIndex() {
  const client = new Sqlite(":memory:");

  client.run(`create virtual table entries using fts5(
    id unindexed, account_id unindexed, channel unindexed, direction unindexed,
    counterpart unindexed, words
  )`);

  return drizzle({ client });
}

// Messages are encrypted at rest, so their words are indexed in memory. The first search indexes
// every message, and each message added after it joins the index.
export class MessageSearch {
  readonly #db: Database;

  readonly #index = createIndex();

  #filled = false;

  constructor(db: Database) {
    this.#db = db;
  }

  add(message: MessageRow) {
    if (this.#filled) this.#index.insert(entries).values(toEntry(message)).run();
  }

  find(query: SearchQuery) {
    if (!this.#filled) this.#fill();

    const found = this.#search(query);

    if (!found.stale) return found.rows;

    // A message removed from the database, as with its account, stays in the index until a search
    // finds it gone, and then the index is built anew.
    this.#fill();

    return this.#search(query).rows;
  }

  // Oldest first, so the newer of two messages has the greater rowid.
  #fill() {
    const stored = this.#db
      .select(indexedColumns)
      .from(messages)
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .all();

    this.#index.transaction((tx) => {
      tx.delete(entries).run();

      for (let start = 0; start < stored.length; start += entriesPerInsert) {
        tx.insert(entries)
          .values(stored.slice(start, start + entriesPerInsert).map(toEntry))
          .run();
      }
    });

    this.#filled = true;
  }

  // The messages the index finds, best match first, and whether the database still has them all.
  #search({ words, limit, accountId, channel, direction, counterpart }: SearchQuery) {
    const ids = this.#index
      .select({ id: entries.id })
      .from(entries)
      .where(
        and(
          matchesAny(words),
          eqIfGiven(entries.accountId, accountId),
          eqIfGiven(entries.channel, channel),
          eqIfGiven(entries.direction, direction),
          eqIfGiven(entries.counterpart, counterpart),
        ),
      )
      // Of equally good matches, the newest first.
      .orderBy(sql`rank`, sql`rowid desc`)
      .limit(limit)
      .all()
      .map(({ id }) => id);

    const rows = this.#db.select().from(messages).where(inArray(messages.id, ids)).all();
    const byId = new Map(rows.map((row) => [row.id, row]));

    return { rows: ids.flatMap((id) => byId.get(id) ?? []), stale: rows.length < ids.length };
  }
}
