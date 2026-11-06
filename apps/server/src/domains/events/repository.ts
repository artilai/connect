import { and, asc, desc, eq, gt, isNotNull } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { events } from "../../platform/db/schema";
import type { NewEvent } from "./schema";

const latestCount = 50;

const pageSize = 100;

type AddOptions = { agentId: string; event: NewEvent };

type ListAfterOptions = { agentId: string; cursor: number };

type FindRelayOptions = { agentId: string; messageId: string };

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

    // A relayed message's event, which names its sender.
    findRelay: ({ agentId, messageId }: FindRelayOptions) =>
      db
        .select()
        .from(events)
        .where(
          and(
            eq(events.agentId, agentId),
            isNotNull(events.sender),
            eq(events.messageId, messageId),
          ),
        )
        .get(),
  };
}

export type EventsRepository = ReturnType<typeof createEventsRepository>;
