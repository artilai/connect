import { and, desc, eq, inArray, isNotNull, lt, max, or, type SQL } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { messages } from "../../platform/db/schema";
import type { Refusal } from "../access/schema";
import type { ChannelKind } from "../channels/schema";
import { messageListLimit, type MessageRow, type NewMessage } from "./schema";

export type MessageFilter = {
  channel?: ChannelKind;
  direction?: "inbound" | "outbound";
  counterpart?: string;
  // Lists the messages older than this one, to page back.
  before?: string;
  limit?: number;
};

type ListOptions = { accountId: string; filter: MessageFilter };

type FindOptions = { accountId: string; id: string };

type FindByExternalIdOptions = {
  addressId: string;
  direction: "inbound" | "outbound";
  externalId: string;
};

type FindLastClientThreadOptions = { addressId: string; where: SQL };

type FindLastClientThreadByCounterpartOptions = { addressId: string; counterpart: string };

type FindLastClientThreadByExternalThreadOptions = { addressId: string; externalThread: string };

type MarkSentOptions = { id: string; externalId: string; externalThread?: string };

type HasReceivedOptions = { addressId: string; externalId: string };

type HasReceivedFromOptions = { accountId: string; channel: ChannelKind; counterpart: string };

type ListRefusedSendersOptions = {
  accountId: string;
  channel: ChannelKind;
  refusals: readonly Refusal[];
};

export function createMessagesRepository(db: Database) {
  function find({ accountId, id }: FindOptions) {
    return db
      .select()
      .from(messages)
      .where(and(eq(messages.accountId, accountId), eq(messages.id, id)))
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
            eq(messages.accountId, accountId),
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

    add: (message: NewMessage) => db.insert(messages).values(message).returning().get(),

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
  };
}

export type MessagesRepository = ReturnType<typeof createMessagesRepository>;
