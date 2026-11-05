import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";

import type { Database } from "../db/connection";
import { files } from "../db/schema";

export type FileRecord = typeof files.$inferSelect;

// What a message tells of a file: its id when the server keeps its bytes, and its description.
export type MessageAttachment = { fileId: string | null; name: string; type: string; size: number };

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

    listByAgent: (agentId: string) =>
      db.select().from(files).where(eq(files.agentId, agentId)).all(),

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

export function toMessageAttachment({ id, name, type, size, key }: FileRecord): MessageAttachment {
  return { fileId: key === null ? null : id, name, type, size };
}
