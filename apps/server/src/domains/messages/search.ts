import { Database as Sqlite } from "bun:sqlite";

import { asc, inArray } from "drizzle-orm";

import { AppError } from "@artil/errors";

import type { Database } from "../../platform/db/connection";
import { messages } from "../../platform/db/schema";
import type { MessageFilter, MessageRow } from "./schema";

export type SearchQuery = Omit<MessageFilter, "before" | "limit"> & {
  words: readonly string[];
  limit: number;
};

type IndexedMessage = Pick<
  MessageRow,
  "id" | "accountId" | "channel" | "direction" | "counterpart" | "subject" | "text"
>;

const shortestWord = 2;

// Each word widens the match, so a long query would hold up the server.
const mostWords = 10;

// Folds case and drops the marks on letters, so ё matches е.
function folded(text: string) {
  return text.normalize("NFD").replaceAll(/\p{M}/gv, "").toLowerCase();
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

// Messages are encrypted at rest, so their words are indexed in memory, from the first search on.
export function createMessageSearch(db: Database) {
  const index = new Sqlite(":memory:", { strict: true });

  index.run(`create virtual table messages using fts5(
    id unindexed, account_id unindexed, channel unindexed, direction unindexed,
    counterpart unindexed, words, tokenize = 'unicode61', prefix = '2 3 4'
  )`);

  const insert = index.prepare(`insert into messages
    (id, account_id, channel, direction, counterpart, words)
    values ($id, $accountId, $channel, $direction, $counterpart, $words)`);

  const remove = index.prepare("delete from messages where id = $id");

  // The best match first, and of equal ones, the newest.
  const findIds = index.prepare<{ id: string }, Record<string, string | number | null>>(`
    select id from messages
    where messages match $match
      and ($accountId is null or account_id = $accountId)
      and ($channel is null or channel = $channel)
      and ($direction is null or direction = $direction)
      and ($counterpart is null or counterpart = $counterpart)
    order by rank, rowid desc
    limit $limit`);

  const add = index.transaction((added: readonly IndexedMessage[]) => {
    for (const message of added) {
      insert.run({
        id: message.id,
        accountId: message.accountId,
        channel: message.channel,
        direction: message.direction,
        counterpart: message.counterpart,
        words: folded(`${message.subject ?? ""}\n${message.text}`),
      });
    }
  });

  let filled = false;

  function fill() {
    add(
      db
        .select({
          id: messages.id,
          accountId: messages.accountId,
          channel: messages.channel,
          direction: messages.direction,
          counterpart: messages.counterpart,
          subject: messages.subject,
          text: messages.text,
        })
        .from(messages)
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .all(),
    );

    filled = true;
  }

  return {
    add(message: MessageRow) {
      if (filled) add([message]);
    },

    find({ words, limit, accountId, channel, direction, counterpart }: SearchQuery) {
      if (!filled) fill();

      // Words hold only letters and digits, so they need no escaping.
      const match = words.map((word) => `"${word}"*`).join(" OR ");

      const filter = {
        match,
        accountId,
        channel: channel ?? null,
        direction: direction ?? null,
        counterpart: counterpart ?? null,
        limit,
      };

      // Drops the messages removed since they were indexed, and searches again.
      for (;;) {
        const ids = findIds.all(filter).map(({ id }) => id);
        const rows = db.select().from(messages).where(inArray(messages.id, ids)).all();
        const found = new Map(rows.map((row) => [row.id, row]));
        const removed = ids.filter((id) => !found.has(id));

        if (removed.length === 0) return ids.flatMap((id) => found.get(id) ?? []);

        for (const id of removed) remove.run({ id });
      }
    },
  };
}
