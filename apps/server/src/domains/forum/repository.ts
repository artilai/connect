import { and, eq } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { topicParticipants, topics } from "../../platform/db/schema";

type AddParticipantsOptions = { topicId: number; accountIds: readonly string[] };

type SetWakesOptions = { topicId: number; accountId: string; wakes: number; countedSince: Date };

export function createForumRepository(db: Database) {
  return {
    addTopic: (title: string) => db.insert(topics).values({ title }).returning().get(),

    findTopicById: (id: number) => db.select().from(topics).where(eq(topics.id, id)).get(),

    // Adds the accounts that are not taking part in the topic yet.
    addParticipants: ({ topicId, accountIds }: AddParticipantsOptions) =>
      db
        .insert(topicParticipants)
        .values(accountIds.map((accountId) => ({ topicId, accountId })))
        .onConflictDoNothing()
        .run(),

    listParticipantsByTopic: (topicId: number) =>
      db.select().from(topicParticipants).where(eq(topicParticipants.topicId, topicId)).all(),

    setWakes: ({ topicId, accountId, wakes, countedSince }: SetWakesOptions) =>
      db
        .update(topicParticipants)
        .set({ wakes, countedSince })
        .where(
          and(eq(topicParticipants.topicId, topicId), eq(topicParticipants.accountId, accountId)),
        )
        .run(),
  };
}

export type ForumRepository = ReturnType<typeof createForumRepository>;
