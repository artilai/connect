import { and, asc, count, desc, eq, gt } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { events } from "../../platform/db/schema";
import type { NewEvent } from "./schema";

const latestCount = 50;

const pageSize = 100;

type AddOptions = { agentId: string; event: NewEvent };

type ListAfterOptions = { agentId: string; cursor: number };

type FindRelayOptions = { agentId: string; messageId: string };

type CountSinceOptions = { agentId: string; since: Date };

export function createEventsRepository(db: Database) {
  return {
    add: ({ agentId, event }: AddOptions) =>
      db
        .insert(events)
        .values({ agentId, ...event })
        .returning()
        .get(),

    // The newest events, newest first.
    listLatest: (agentId: string) =>
      db
        .select()
        .from(events)
        .where(eq(events.agentId, agentId))
        .orderBy(desc(events.id))
        .limit(latestCount)
        .all(),

    // The events that followed the cursor, oldest first.
    listAfter: ({ agentId, cursor }: ListAfterOptions) =>
      db
        .select()
        .from(events)
        .where(and(eq(events.agentId, agentId), gt(events.id, cursor)))
        .orderBy(asc(events.id))
        .limit(pageSize)
        .all(),

    findLastId: (agentId: string) =>
      db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.agentId, agentId))
        .orderBy(desc(events.id))
        .limit(1)
        .get()?.id ?? 0,

    findRelay: ({ agentId, messageId }: FindRelayOptions) =>
      db
        .select()
        .from(events)
        .where(
          and(
            eq(events.agentId, agentId),
            eq(events.channel, "url"),
            eq(events.messageId, messageId),
          ),
        )
        .get(),

    countSince: ({ agentId, since }: CountSinceOptions) =>
      db
        .select({ count: count() })
        .from(events)
        .where(and(eq(events.agentId, agentId), gt(events.createdAt, since)))
        .get()?.count ?? 0,
  };
}

export type EventsRepository = ReturnType<typeof createEventsRepository>;
