import { and, eq } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { forumWakes, topicParticipants, topics } from "../../platform/db/schema";

type AddParticipantsOptions = { topicId: number; accountIds: readonly string[] };

// The account a poster's posts wake.
type WakesOptions = { posterId: string; accountId: string };

type SetWakesOptions = WakesOptions & { wakes: number; countedSince: Date };

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
      db
        .select({ accountId: topicParticipants.accountId })
        .from(topicParticipants)
        .where(eq(topicParticipants.topicId, topicId))
        .all()
        .map(({ accountId }) => accountId),

    findWakes: ({ posterId, accountId }: WakesOptions) =>
      db
        .select()
        .from(forumWakes)
        .where(and(eq(forumWakes.posterId, posterId), eq(forumWakes.accountId, accountId)))
        .get(),

    setWakes: ({ posterId, accountId, wakes, countedSince }: SetWakesOptions) =>
      db
        .insert(forumWakes)
        .values({ posterId, accountId, wakes, countedSince })
        .onConflictDoUpdate({
          target: [forumWakes.posterId, forumWakes.accountId],
          set: { wakes, countedSince },
        })
        .run(),
  };
}

export type ForumRepository = ReturnType<typeof createForumRepository>;
