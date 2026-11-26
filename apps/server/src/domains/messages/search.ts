import { Database as Sqlite } from "bun:sqlite";

import { asc, gt, inArray } from "drizzle-orm";

import { AppError } from "@artil/errors";

import type { Database } from "../../platform/db/connection";
import { messages } from "../../platform/db/schema";
import type { MessageFilter, MessageRow } from "./schema";

// Which messages a search reads, as a list narrows them, and the words it looks for.
export type SearchQuery = Omit<MessageFilter, "before" | "limit"> & {
  words: readonly string[];
  limit: number;
};

// A one-letter word begins nearly every word, so it finds nothing in particular.
const shortestWord = 2;

// How many messages the index takes from the database at a time as it fills, so the server never
// holds them all in memory at once.
const fillPage = 1000;

// Lowercases the text and leaves the marks off its letters, so a word matches with them or
// without, like ё and е, and so й and и, which brings деплой to деплоить.
function folded(text: string) {
  return text.normalize("NFD").replaceAll(/\p{M}/gv, "").toLowerCase();
}

// The words of what someone searches for, folded as the messages are.
export function readSearchWords(search: string) {
  const words = folded(search)
    .split(/[^\p{L}\p{N}]+/v)
    .filter((word) => word.length >= shortestWord);

  if (words.length === 0) {
    throw new AppError({
      code: "invalid_input",
      message: `Search for words of ${shortestWord} letters or more`,
    });
  }

  return words;
}

// A full-text index of the messages' words, in memory, since the messages are encrypted at rest. It
// keeps the words and what a list narrows by, never the text.
function createWordIndex() {
  const index = new Sqlite(":memory:");

  // A removed message leaves this table, whose rowids are never used again, and its words stay
  // behind in the index with nothing to join to.
  index.run(`create table messages (
    rowid integer primary key autoincrement,
    id text not null unique,
    account_id text not null,
    channel text not null,
    direction text not null,
    counterpart text not null,
    created_at integer not null
  )`);

  // Each word matches as the start of a longer one too, which the prefix indexes keep quick.
  index.run(`create virtual table words using fts5(
    subject, text, content = '', tokenize = 'unicode61', prefix = '2 3 4'
  )`);

  const insertMessage = index.prepare(
    "insert into messages (id, account_id, channel, direction, counterpart, created_at) values (?, ?, ?, ?, ?, ?)",
  );

  const insertWords = index.prepare("insert into words (rowid, subject, text) values (?, ?, ?)");

  const removeMessage = index.prepare("delete from messages where id = ?");

  return {
    add(message: MessageRow) {
      const { lastInsertRowid } = insertMessage.run(
        message.id,
        message.accountId,
        message.channel,
        message.direction,
        message.counterpart,
        message.createdAt.getTime(),
      );

      insertWords.run(lastInsertRowid, folded(message.subject ?? ""), folded(message.text));
    },

    remove(id: string) {
      removeMessage.run(id);
    },

    // The ids of the messages that hold any of the words, best match first: a word in the subject
    // counts twice, and the newest comes first among equal matches.
    find({ words, limit, accountId, channel, direction, counterpart }: SearchQuery) {
      const narrowing = [
        ["account_id", accountId],
        ["channel", channel],
        ["direction", direction],
        ["counterpart", counterpart],
      ].flatMap(([column, value]) => (value ? [{ column, value }] : []));

      // Each word is letters and digits only, so as a phrase it needs no escaping.
      const match = words.map((word) => `"${word}"*`).join(" OR ");

      return index
        .query<{ id: string }, (string | number)[]>(
          `select messages.id from words join messages on messages.rowid = words.rowid
           where words match ?${narrowing.map(({ column }) => ` and messages.${column} = ?`).join("")}
           order by bm25(words, 2, 1), messages.created_at desc, messages.rowid desc
           limit ?`,
        )
        .all(match, ...narrowing.map(({ value }) => value), limit)
        .map(({ id }) => id);
    },
  };
}

// The search of the server's messages. Its index takes every message the first time a search needs
// it, and each one the server adds from then on.
export function createMessageSearch(db: Database) {
  const index = createWordIndex();
  let filled = false;

  // Takes every message, a page at a time in the order of their ids.
  function fill() {
    let page: MessageRow[] = [];

    do {
      page = db
        .select()
        .from(messages)
        .where(gt(messages.id, page.at(-1)?.id ?? ""))
        .orderBy(asc(messages.id))
        .limit(fillPage)
        .all();

      for (const message of page) index.add(message);
    } while (page.length === fillPage);

    filled = true;
  }

  return {
    add(message: MessageRow) {
      if (filled) index.add(message);
    },

    // The messages that hold the words, best match first. A message removed since the index took
    // it, with its account, leaves the index once a search meets it, and the search looks again
    // past it.
    find(query: SearchQuery) {
      if (!filled) fill();

      for (;;) {
        const ids = index.find(query);

        const kept = db.select().from(messages).where(inArray(messages.id, ids)).all();
        const found = new Map(kept.map((message) => [message.id, message]));
        const removed = ids.filter((id) => !found.has(id));

        if (removed.length === 0) return ids.flatMap((id) => found.get(id) ?? []);

        for (const id of removed) index.remove(id);
      }
    },
  };
}
