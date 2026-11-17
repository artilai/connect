import { Database } from "bun:sqlite";

import { AppError } from "@artil/errors";

import type { ChannelKind } from "../channels/schema";

// What the index keeps of a message: what a search finds it by, and what a list narrows it by.
export type IndexedMessage = {
  id: string;
  accountId: string;
  channel: ChannelKind;
  direction: "inbound" | "outbound";
  counterpart: string;
  createdAt: Date;
  subject: string | null;
  text: string;
};

// Which messages a search reads: the account's, or everyone's when it names none, and of those, the
// ones on the channel, in the direction and with the counterpart it names.
type IndexQuery = {
  accountId?: string;
  channel?: ChannelKind;
  direction?: "inbound" | "outbound";
  counterpart?: string;
  words: readonly string[];
  limit: number;
};

// A one-letter word begins nearly every word, so it finds nothing in particular.
const shortestWord = 2;

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

// A full-text index of messages, which lives in memory because they are encrypted at rest. The
// server fills it once and adds each new message, so a search reads the index rather than decrypting
// the messages. It keeps the words and what a list narrows by, not the text.
export function createSearchIndex() {
  const index = new Database(":memory:");

  index.run(`create table messages (
    rowid integer primary key,
    id text not null unique,
    account_id text not null,
    channel text not null,
    direction text not null,
    counterpart text not null,
    created_at integer not null
  )`);

  // Each word matches as the start of a longer one too, which the prefix indexes keep quick.
  index.run(`create virtual table words using fts5(
    subject, text, content = '', contentless_delete = 1, tokenize = 'unicode61', prefix = '2 3 4'
  )`);

  const insertMessage = index.prepare(
    "insert into messages (id, account_id, channel, direction, counterpart, created_at) values (?, ?, ?, ?, ?, ?)",
  );

  const insertWords = index.prepare("insert into words (rowid, subject, text) values (?, ?, ?)");

  const removeWords = index.prepare(
    "delete from words where rowid = (select rowid from messages where id = ?)",
  );

  const removeMessage = index.prepare("delete from messages where id = ?");

  return {
    add({
      id,
      accountId,
      channel,
      direction,
      counterpart,
      createdAt,
      subject,
      text,
    }: IndexedMessage) {
      const { lastInsertRowid } = insertMessage.run(
        id,
        accountId,
        channel,
        direction,
        counterpart,
        createdAt.getTime(),
      );

      insertWords.run(lastInsertRowid, folded(subject ?? ""), folded(text));
    },

    remove(id: string) {
      removeWords.run(id);
      removeMessage.run(id);
    },

    // The ids of the messages that hold any of the words, best match first: a word in the subject
    // counts twice, and the newest comes first among equal matches.
    search({ words, limit, ...narrowing }: IndexQuery) {
      const columns = Object.entries({
        account_id: narrowing.accountId,
        channel: narrowing.channel,
        direction: narrowing.direction,
        counterpart: narrowing.counterpart,
      }).flatMap(([column, value]) => (value ? [{ column, value }] : []));

      // Each word is letters and digits only, so as a phrase it needs no escaping.
      const match = words.map((word) => `"${word}"*`).join(" OR ");

      const narrowed = columns.map(({ column }) => ` and messages.${column} = ?`).join("");

      return index
        .query<{ id: string }, (string | number)[]>(
          `select messages.id from words join messages on messages.rowid = words.rowid
           where words match ?${narrowed}
           order by bm25(words, 2, 1), messages.created_at desc, messages.rowid desc
           limit ?`,
        )
        .all(match, ...columns.map(({ value }) => value), limit)
        .map(({ id }) => id);
    },
  };
}
