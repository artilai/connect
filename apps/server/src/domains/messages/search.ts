import { Database as Sqlite } from "bun:sqlite";

import { asc, gt, inArray } from "drizzle-orm";

import { AppError } from "@artil/errors";

import type { Database } from "../../platform/db/connection";
import { messages } from "../../platform/db/schema";
import type { MessageFilter, MessageRow } from "./schema";

type IndexedMessage = Pick<
  MessageRow,
  "id" | "accountId" | "channel" | "direction" | "counterpart" | "createdAt" | "subject" | "text"
>;

export type SearchQuery = Omit<MessageFilter, "before" | "limit"> & {
  words: readonly string[];
  limit: number;
};

const shortestWord = 2;

const fillPage = 1000;

// Folds case and drops the marks on letters, so ё matches е.
function folded(text: string) {
  return text.normalize("NFD").replaceAll(/\p{M}/gv, "").toLowerCase();
}

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

// Messages are encrypted at rest, so their words are indexed in memory.
function createWordIndex() {
  const index = new Sqlite(":memory:", { strict: true });

  // A contentless index cannot delete words, so removing a message removes only its row here.
  index.run(`create table messages (
    rowid integer primary key autoincrement,
    id text not null unique,
    account_id text not null,
    channel text not null,
    direction text not null,
    counterpart text not null,
    created_at integer not null
  )`);

  index.run(`create virtual table words using fts5(
    subject, text, content = '', tokenize = 'unicode61', prefix = '2 3 4'
  )`);

  const insertMessage = index.prepare(`insert into messages
    (id, account_id, channel, direction, counterpart, created_at)
    values ($id, $accountId, $channel, $direction, $counterpart, $createdAt)`);

  const insertWords = index.prepare(
    "insert into words (rowid, subject, text) values ($rowid, $subject, $text)",
  );

  const removeMessage = index.prepare("delete from messages where id = $id");

  // A word in the subject counts twice, and the newest message wins a tie.
  const findIds = index.prepare<{ id: string }, Record<string, string | number | null>>(`
    select messages.id from words join messages on messages.rowid = words.rowid
    where words match $match
      and ($accountId is null or messages.account_id = $accountId)
      and ($channel is null or messages.channel = $channel)
      and ($direction is null or messages.direction = $direction)
      and ($counterpart is null or messages.counterpart = $counterpart)
    order by bm25(words, 2, 1), messages.created_at desc, messages.rowid desc
    limit $limit`);

  return {
    add(added: readonly IndexedMessage[]) {
      index.transaction(() => {
        for (const message of added) {
          const { lastInsertRowid } = insertMessage.run({
            id: message.id,
            accountId: message.accountId,
            channel: message.channel,
            direction: message.direction,
            counterpart: message.counterpart,
            createdAt: message.createdAt.getTime(),
          });

          insertWords.run({
            rowid: lastInsertRowid,
            subject: folded(message.subject ?? ""),
            text: folded(message.text),
          });
        }
      })();
    },

    remove(id: string) {
      removeMessage.run({ id });
    },

    find: ({ words, limit, accountId, channel, direction, counterpart }: SearchQuery) =>
      findIds
        .all({
          // Words hold only letters and digits, so they need no escaping.
          match: words.map((word) => `"${word}"*`).join(" OR "),
          accountId,
          channel: channel ?? null,
          direction: direction ?? null,
          counterpart: counterpart ?? null,
          limit,
        })
        .map(({ id }) => id),
  };
}

// The index takes every message on the first search, and each new one after that.
export function createMessageSearch(db: Database) {
  const index = createWordIndex();
  let filled = false;

  function fill() {
    let page: IndexedMessage[] = [];

    do {
      page = db
        .select({
          id: messages.id,
          accountId: messages.accountId,
          channel: messages.channel,
          direction: messages.direction,
          counterpart: messages.counterpart,
          createdAt: messages.createdAt,
          subject: messages.subject,
          text: messages.text,
        })
        .from(messages)
        .where(gt(messages.id, page.at(-1)?.id ?? ""))
        .orderBy(asc(messages.id))
        .limit(fillPage)
        .all();

      index.add(page);
    } while (page.length === fillPage);

    filled = true;
  }

  return {
    add(message: MessageRow) {
      if (filled) index.add([message]);
    },

    find(query: SearchQuery) {
      if (!filled) fill();

      // Drops the messages removed since they were indexed, and searches again.
      for (;;) {
        const ids = index.find(query);
        const rows = db.select().from(messages).where(inArray(messages.id, ids)).all();
        const found = new Map(rows.map((row) => [row.id, row]));
        const removed = ids.filter((id) => !found.has(id));

        if (removed.length === 0) return ids.flatMap((id) => found.get(id) ?? []);

        for (const id of removed) index.remove(id);
      }
    },
  };
}
