import { and, asc, desc, eq, gt } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { events } from "../../platform/db/schema";
import type { NewEvent } from "./schema";

const latestCount = 50;

const pageSize = 100;

type AddOptions = { accountId: string; event: NewEvent };

type ListAfterOptions = { accountId: string; cursor: number };

export function createEventsRepository(db: Database) {
  return {
    add: ({ accountId, event }: AddOptions) =>
      db
        .insert(events)
        .values({ accountId, ...event })
        .run(),

    // The newest events, newest first.
    listLatest: (accountId: string) =>
      db
        .select()
        .from(events)
        .where(eq(events.accountId, accountId))
        .orderBy(desc(events.id))
        .limit(latestCount)
        .all(),

    // The events that followed the cursor, oldest first.
    listAfter: ({ accountId, cursor }: ListAfterOptions) =>
      db
        .select()
        .from(events)
        .where(and(eq(events.accountId, accountId), gt(events.id, cursor)))
        .orderBy(asc(events.id))
        .limit(pageSize)
        .all(),

    findLastId: (accountId: string) =>
      db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.accountId, accountId))
        .orderBy(desc(events.id))
        .limit(1)
        .get()?.id ?? 0,
  };
}

export type EventsRepository = ReturnType<typeof createEventsRepository>;
