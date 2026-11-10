import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { files } from "../../platform/db/schema";

export type NewFile = Omit<typeof files.$inferInsert, "createdAt">;

export function createFilesRepository(db: Database) {
  return {
    add: (file: NewFile) => db.insert(files).values(file).returning().get(),

    findById: (id: string) => db.select().from(files).where(eq(files.id, id)).get(),

    // The files of each message, in the order they came.
    listByMessages(messageIds: readonly string[]) {
      const rows =
        messageIds.length === 0
          ? []
          : db
              .select()
              .from(files)
              .where(inArray(files.messageId, [...messageIds]))
              .orderBy(files.createdAt)
              .all();

      return Map.groupBy(rows, ({ messageId }) => messageId);
    },

    listByAccount: (accountId: string) =>
      db.select().from(files).where(eq(files.accountId, accountId)).all(),

    listExpired: (now: Date) =>
      db
        .select()
        .from(files)
        .where(and(isNotNull(files.expiresAt), lt(files.expiresAt, now)))
        .all(),

    remove: (id: string) => db.delete(files).where(eq(files.id, id)).run(),
  };
}

export type FilesRepository = ReturnType<typeof createFilesRepository>;
