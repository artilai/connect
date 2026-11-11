import { and, desc, eq, lt, or } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { messages } from "../../platform/db/schema";
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

type ListOptions = { agentId: string; filter: MessageFilter };

type FindOptions = { agentId: string; id: string };

type FindByExternalIdOptions = {
  agentId: string;
  direction: "inbound" | "outbound";
  externalId: string;
};

type HasReceivedOptions = { addressId: string; externalId: string };

type HasReceivedFromOptions = { agentId: string; channel: ChannelKind; counterpart: string };

export function createMessagesRepository(db: Database) {
  function find({ agentId, id }: FindOptions) {
    return db
      .select()
      .from(messages)
      .where(and(eq(messages.agentId, agentId), eq(messages.id, id)))
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

    list({ agentId, filter }: ListOptions) {
      const { channel, direction, counterpart, before, limit = messageListLimit } = filter;
      const anchor = before === undefined ? undefined : find({ agentId, id: before });

      // A message the agent does not have leaves nothing older.
      if (before !== undefined && !anchor) return [];

      return db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.agentId, agentId),
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

    findByExternalId: ({ agentId, direction, externalId }: FindByExternalIdOptions) =>
      db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.agentId, agentId),
            eq(messages.direction, direction),
            eq(messages.externalId, externalId),
          ),
        )
        .get(),

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

    hasReceivedFrom: ({ agentId, channel, counterpart }: HasReceivedFromOptions) =>
      db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.agentId, agentId),
            eq(messages.channel, channel),
            eq(messages.direction, "inbound"),
            eq(messages.counterpart, counterpart),
          ),
        )
        .get() !== undefined,

    // Marks a message the server sent with the id the provider gave it.
    markSent: (id: string, externalId: string) =>
      db.update(messages).set({ status: "sent", externalId }).where(eq(messages.id, id)).run(),

    markFailed: (id: string, error: string) =>
      db.update(messages).set({ status: "failed", error }).where(eq(messages.id, id)).run(),
  };
}

export type MessagesRepository = ReturnType<typeof createMessagesRepository>;
