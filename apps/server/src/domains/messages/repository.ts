import { and, asc, desc, eq, gt, inArray, isNotNull, lt, max, or, type SQL } from "drizzle-orm";

import { channel as forumChannel } from "@artil/forum-channel";

import type { Database } from "../../platform/db/connection";
import { messages } from "../../platform/db/schema";
import type { Refusal } from "../access/schema";
import type { ChannelKind } from "../channels/schema";
import { messageListLimit, type MessageRow, type NewMessage, subjectOf } from "./schema";
import { createSearchIndex, type IndexedMessage } from "./search";

export type MessageFilter = {
  channel?: ChannelKind;
  direction?: "inbound" | "outbound";
  counterpart?: string;
  // Lists the messages older than this one, to page back.
  before?: string;
  limit?: number;
};

type ListOptions = { accountId: string; filter: MessageFilter };

// A search narrows the messages as a list does, and lists its best matches, so it pages back from
// no message.
type SearchFilter = Omit<MessageFilter, "before"> & { words: readonly string[] };

type SearchOptions = { accountId: string; filter: SearchFilter };

type FindOptions = { accountId: string; id: string };

type FindByExternalIdOptions = {
  addressId: string;
  direction: "inbound" | "outbound";
  externalId: string;
};

type FindLastClientThreadOptions = { addressId: string; where: SQL };

type FindLastClientThreadByCounterpartOptions = { addressId: string; counterpart: string };

type FindLastClientThreadByExternalThreadOptions = { addressId: string; externalThread: string };

type FindLastClientThreadByGroupOptions = {
  accountId: string;
  channel: ChannelKind;
  counterpart: string;
};

type MarkSentOptions = { id: string; externalId: string; externalThread?: string };

type HasReceivedOptions = { addressId: string; externalId: string };

type HasReceivedFromOptions = { accountId: string; channel: ChannelKind; counterpart: string };

type ListRefusedSendersOptions = {
  accountId: string;
  channel: ChannelKind;
  refusals: readonly Refusal[];
};

// The forum's posts are the whole team's, which every account reads. Any other message is only its
// account's.
function readableBy(accountId: string) {
  return or(eq(messages.accountId, accountId), eq(messages.channel, forumChannel.kind));
}

// How many messages the index takes from the database at a time when it fills, so the server does
// not decrypt every one of them at once.
const indexPage = 1000;

function toIndexed(row: MessageRow): IndexedMessage {
  return { ...row, subject: subjectOf(row) };
}

export function createMessagesRepository(db: Database) {
  const searchIndex = createSearchIndex();
  let indexFilled = false;

  // The index, which takes every message the first time a search needs it, and each one added from
  // then on. The server is the one process that adds messages; one removed meanwhile, with its
  // account, is left out of what a search finds.
  function filledIndex() {
    if (indexFilled) return searchIndex;

    let page = db.select().from(messages).orderBy(asc(messages.id)).limit(indexPage).all();

    while (page.length > 0) {
      for (const row of page) searchIndex.add(toIndexed(row));

      const last = page.at(-1)?.id ?? "";

      page = db
        .select()
        .from(messages)
        .where(gt(messages.id, last))
        .orderBy(asc(messages.id))
        .limit(indexPage)
        .all();
    }

    indexFilled = true;

    return searchIndex;
  }

  function find({ accountId, id }: FindOptions) {
    return db
      .select()
      .from(messages)
      .where(and(readableBy(accountId), eq(messages.id, id)))
      .get();
  }

  // The thread of the client whose message from the address last went where the condition says, of
  // those that named one.
  function findLastClientThread({ addressId, where }: FindLastClientThreadOptions) {
    return (
      db
        .select({ clientThread: messages.clientThread })
        .from(messages)
        .where(
          and(
            eq(messages.addressId, addressId),
            eq(messages.direction, "outbound"),
            where,
            eq(messages.status, "sent"),
            isNotNull(messages.clientThread),
          ),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(1)
        .get()?.clientThread ?? null
    );
  }

  // Newer messages first, the latest of those created in the same millisecond by id.
  function olderThan(anchor: MessageRow) {
    return or(
      lt(messages.createdAt, anchor.createdAt),
      and(eq(messages.createdAt, anchor.createdAt), lt(messages.id, anchor.id)),
    );
  }

  return {
    find,

    list({ accountId, filter }: ListOptions) {
      const { channel, direction, counterpart, before, limit = messageListLimit } = filter;
      const anchor = before ? find({ accountId, id: before }) : undefined;

      // A message the account does not have leaves nothing older.
      if (before && !anchor) return [];

      return db
        .select()
        .from(messages)
        .where(
          and(
            // The forum lists everyone's posts, and the rest of the messages are the account's.
            channel === forumChannel.kind ? undefined : eq(messages.accountId, accountId),
            channel ? eq(messages.channel, channel) : undefined,
            direction && eq(messages.direction, direction),
            counterpart ? eq(messages.counterpart, counterpart) : undefined,
            anchor && olderThan(anchor),
          ),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit)
        .all();
    },

    findByExternalId: ({ addressId, direction, externalId }: FindByExternalIdOptions) =>
      db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.addressId, addressId),
            eq(messages.direction, direction),
            eq(messages.externalId, externalId),
          ),
        )
        .get(),

    findLastClientThreadByCounterpart: ({
      addressId,
      counterpart,
    }: FindLastClientThreadByCounterpartOptions) =>
      findLastClientThread({ addressId, where: eq(messages.counterpart, counterpart) }),

    findLastClientThreadByExternalThread: ({
      addressId,
      externalThread,
    }: FindLastClientThreadByExternalThreadOptions) =>
      findLastClientThread({ addressId, where: eq(messages.externalThread, externalThread) }),

    // The thread of the account's client that last wrote in a group of the channel, like a topic on
    // the forum, of the messages that named one.
    findLastClientThreadByGroup: ({
      accountId,
      channel,
      counterpart,
    }: FindLastClientThreadByGroupOptions) =>
      db
        .select({ clientThread: messages.clientThread })
        .from(messages)
        .where(
          and(
            eq(messages.accountId, accountId),
            eq(messages.channel, channel),
            eq(messages.counterpart, counterpart),
            isNotNull(messages.clientThread),
          ),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(1)
        .get()?.clientThread ?? null,

    add(message: NewMessage) {
      const added = db.insert(messages).values(message).returning().get();

      if (indexFilled) searchIndex.add(toIndexed(added));

      return added;
    },

    // The messages the filter narrows to that hold any of the words, best match first.
    search({ accountId, filter }: SearchOptions) {
      const { channel, words, limit = messageListLimit } = filter;

      const found = filledIndex().search({
        ...filter,
        // The forum lists everyone's posts, and the rest of the messages are the account's.
        accountId: channel === forumChannel.kind ? undefined : accountId,
        words,
        limit,
      });

      if (found.length === 0) return [];

      const rows = db.select().from(messages).where(inArray(messages.id, found)).all();

      return rows.toSorted((first, second) => found.indexOf(first.id) - found.indexOf(second.id));
    },

    // A provider that delivers a message twice gets the one the server already took.
    hasReceived: ({ addressId, externalId }: HasReceivedOptions) =>
      Boolean(
        db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.addressId, addressId),
              eq(messages.direction, "inbound"),
              eq(messages.externalId, externalId),
            ),
          )
          .get(),
      ),

    hasReceivedFrom: ({ accountId, channel, counterpart }: HasReceivedFromOptions) =>
      Boolean(
        db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.accountId, accountId),
              eq(messages.channel, channel),
              eq(messages.direction, "inbound"),
              eq(messages.counterpart, counterpart),
            ),
          )
          .get(),
      ),

    // Who wrote to the account on the channel and was refused for one of the reasons, the latest
    // first, by the name they last gave.
    listRefusedSenders: ({ accountId, channel, refusals }: ListRefusedSendersOptions) =>
      db
        .select({ sender: messages.counterpart, name: messages.counterpartName })
        .from(messages)
        .where(
          and(
            eq(messages.accountId, accountId),
            eq(messages.channel, channel),
            inArray(messages.refusal, refusals),
          ),
        )
        .groupBy(messages.counterpart)
        .orderBy(desc(max(messages.createdAt)))
        .all(),

    // Marks a message the server sent with the id the provider gave it, and the thread it went in.
    markSent: ({ id, externalId, externalThread }: MarkSentOptions) =>
      db
        .update(messages)
        .set({ status: "sent", externalId, externalThread })
        .where(eq(messages.id, id))
        .run(),

    markFailed: (id: string, error: string) =>
      db.update(messages).set({ status: "failed", error }).where(eq(messages.id, id)).run(),

    markAnswered: (id: string) =>
      db.update(messages).set({ answeredAt: new Date() }).where(eq(messages.id, id)).run(),
  };
}

export type MessagesRepository = ReturnType<typeof createMessagesRepository>;
