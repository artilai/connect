import { and, desc, eq, inArray, lt, max, or } from "drizzle-orm";

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
      const anchor = before === undefined ? undefined : find({ accountId, id: before });

      // A message the account does not have leaves nothing older.
      if (before !== undefined && !anchor) return [];

      return db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.accountId, accountId),
            channel === undefined ? undefined : eq(messages.channel, channel),
            direction && eq(messages.direction, direction),
            counterpart === undefined ? undefined : eq(messages.counterpart, counterpart),
            anchor && olderThan(anchor),
          ),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit)
        .all();
    },

    add: (message: NewMessage) => db.insert(messages).values(message).returning().get(),

    // A provider that delivers a message twice gets the one the server already took.
    hasReceived: ({ addressId, externalId }: HasReceivedOptions) =>
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
        .get() !== undefined,

    hasReceivedFrom: ({ accountId, channel, counterpart }: HasReceivedFromOptions) =>
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
        .get() !== undefined,

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

    // Marks a message the server sent with the id the provider gave it.
    markSent: (id: string, externalId: string) =>
      db.update(messages).set({ status: "sent", externalId }).where(eq(messages.id, id)).run(),

    markFailed: (id: string, error: string) =>
      db.update(messages).set({ status: "failed", error }).where(eq(messages.id, id)).run(),
  };
}

export type MessagesRepository = ReturnType<typeof createMessagesRepository>;
