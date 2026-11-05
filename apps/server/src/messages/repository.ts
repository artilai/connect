import { and, desc, eq, lt, or } from "drizzle-orm";

import type { ChannelKind } from "../channels/kinds";
import type { Database } from "../db/connection";
import { messages } from "../db/schema";
import {
  toMessageAttachment,
  type FilesRepository,
  type MessageAttachment,
} from "../files/repository";

export const messageListLimit = 50;

type Row = typeof messages.$inferSelect;

export type MessageRecord = Omit<Row, "agentId" | "externalId"> & {
  attachments: MessageAttachment[];
};

export type NewMessage = Omit<typeof messages.$inferInsert, "createdAt">;

type MessageFilter = {
  channel?: ChannelKind;
  direction?: "inbound" | "outbound";
  counterpart?: string;
  // Lists the messages older than this one, to page back.
  before?: string;
  limit?: number;
};

type ListOptions = { agentId: string; filter: MessageFilter };

type FindOptions = { agentId: string; id: string };

type HasReceivedOptions = { addressId: string; externalId: string };

type HasReceivedFromOptions = { agentId: string; channel: ChannelKind; counterpart: string };

type CreateMessagesRepositoryOptions = { db: Database; files: FilesRepository };

export function createMessagesRepository({ db, files }: CreateMessagesRepositoryOptions) {
  function toRecords(rows: Row[]): MessageRecord[] {
    const filesByMessage = files.listByMessages(rows.map(({ id }) => id));

    return rows.map(({ agentId: _agentId, externalId: _externalId, ...message }) => ({
      ...message,
      attachments: (filesByMessage.get(message.id) ?? []).map(toMessageAttachment),
    }));
  }

  function find({ agentId, id }: FindOptions) {
    const row = db
      .select()
      .from(messages)
      .where(and(eq(messages.agentId, agentId), eq(messages.id, id)))
      .get();

    return row && toRecords([row])[0];
  }

  // Newer messages first, the latest of those created in the same millisecond by id.
  function olderThan(anchor: MessageRecord) {
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

      const rows = db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.agentId, agentId),
            channel && eq(messages.channel, channel),
            direction && eq(messages.direction, direction),
            counterpart === undefined ? undefined : eq(messages.counterpart, counterpart),
            anchor && olderThan(anchor),
          ),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit)
        .all();

      return toRecords(rows);
    },

    add(message: NewMessage) {
      const row = db.insert(messages).values(message).returning().get();
      const [record] = toRecords([row]);

      if (!record) throw new Error(`Message ${row.id} went missing`);

      return record;
    },

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
