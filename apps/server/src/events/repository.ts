import { and, asc, count, desc, eq, gt } from "drizzle-orm";

import { hour } from "@artil/utils/time";

import type { ChannelKind, RelayKind } from "../channels/kinds";
import type { Database } from "../db/connection";
import { events } from "../db/schema";
import {
  toMessageAttachment,
  type FilesRepository,
  type MessageAttachment,
} from "../files/repository";
import type { Teammate } from "../team/teammate";
import type { EventBus } from "./bus";

const latestCount = 50;

const pageSize = 100;

type Arrival = { type: "message.received"; channel: ChannelKind; messageId: string };

// The Message URL hands a message on whole, with the sender's thread to answer in, the agent's
// thread it is for, and the client the sender wrote it in.
type Relay = {
  type: "message.received";
  channel: RelayKind;
  messageId: string;
  text: string | null;
  sender: Teammate;
  thread: string | null;
  toThread: string | null;
  client: string | null;
};

type Stamped<Event> = Event & { id: number; createdAt: Date };

export type RelayRecord = Stamped<Relay> & { attachments: MessageAttachment[] };

export type EventRecord = Stamped<Arrival> | RelayRecord;

type Row = typeof events.$inferSelect;

type CreateEventsRepositoryOptions = { db: Database; files: FilesRepository; bus: EventBus };

type AddOptions = { agentId: string; event: Arrival | Relay };

type ListAfterOptions = { agentId: string; cursor: number };

type FindRelayOptions = { agentId: string; messageId: string };

export function createEventsRepository({ db, files, bus }: CreateEventsRepositoryOptions) {
  function toRecords(rows: Row[]): EventRecord[] {
    const filesByMessage = files.listByMessages(
      rows.flatMap(({ channel, messageId }) => (channel === "url" ? [messageId] : [])),
    );

    return rows.map(
      ({ id, type, channel, messageId, text, sender, thread, toThread, client, createdAt }) => {
        if (channel !== "url") return { id, type, channel, messageId, createdAt };

        if (!sender) throw new Error(`Event ${id} on url names no sender`);

        return {
          id,
          type,
          channel,
          messageId,
          text,
          sender,
          thread,
          toThread,
          client,
          createdAt,
          attachments: (filesByMessage.get(messageId) ?? []).map(toMessageAttachment),
        };
      },
    );
  }

  return {
    add({ agentId, event }: AddOptions) {
      const row = db
        .insert(events)
        .values({ agentId, ...event })
        .returning()
        .get();

      bus.publish(agentId);

      const [record] = toRecords([row]);

      if (!record) throw new Error(`Event ${row.id} went missing`);

      return record;
    },

    // The newest events, newest first.
    listLatest: (agentId: string) =>
      toRecords(
        db
          .select()
          .from(events)
          .where(eq(events.agentId, agentId))
          .orderBy(desc(events.id))
          .limit(latestCount)
          .all(),
      ),

    // The events that followed the cursor, oldest first.
    listAfter: ({ agentId, cursor }: ListAfterOptions) =>
      toRecords(
        db
          .select()
          .from(events)
          .where(and(eq(events.agentId, agentId), gt(events.id, cursor)))
          .orderBy(asc(events.id))
          .limit(pageSize)
          .all(),
      ),

    findLastId: (agentId: string) =>
      db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.agentId, agentId))
        .orderBy(desc(events.id))
        .limit(1)
        .get()?.id ?? 0,

    // A message the Message URL relayed to the agent, to answer whoever sent it.
    findRelay({ agentId, messageId }: FindRelayOptions) {
      const row = db
        .select()
        .from(events)
        .where(
          and(
            eq(events.agentId, agentId),
            eq(events.channel, "url"),
            eq(events.messageId, messageId),
          ),
        )
        .get();

      const [record] = row ? toRecords([row]) : [];

      return record && isRelay(record) ? record : undefined;
    },

    // Every message that reached the agent woke it, whichever channel it came by.
    countWakesInLastHour: (agentId: string) =>
      db
        .select({ count: count() })
        .from(events)
        .where(and(eq(events.agentId, agentId), gt(events.createdAt, new Date(Date.now() - hour))))
        .get()?.count ?? 0,

    subscribe: (agentId: string, listener: () => void) => bus.subscribe(agentId, listener),
  };
}

export type EventsRepository = ReturnType<typeof createEventsRepository>;

export function isRelay(event: EventRecord): event is RelayRecord {
  return event.channel === "url";
}
