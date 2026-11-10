import { and, count, eq, gt, isNull, lt } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { signIns } from "../../platform/db/schema";
import type { NewSignIn } from "./schema";

type ApproveOptions = { id: string; accountId: string; codeHash: string };

export function createSignInsRepository(db: Database) {
  function pendingWhere(id: string) {
    return and(eq(signIns.id, id), isNull(signIns.codeHash), gt(signIns.expiresAt, new Date()));
  }

  return {
    removeExpired: () => db.delete(signIns).where(lt(signIns.expiresAt, new Date())).run(),

    count: () => db.select({ count: count() }).from(signIns).get()?.count ?? 0,

    create: (signIn: NewSignIn) => db.insert(signIns).values(signIn).returning().get(),

    findPending: (id: string) => db.select().from(signIns).where(pendingWhere(id)).get(),

    // Gives a pending sign-in its account and the hash of its code, and says whether it did.
    approve: ({ id, accountId, codeHash }: ApproveOptions) =>
      db
        .update(signIns)
        .set({ accountId, codeHash })
        .where(pendingWhere(id))
        .returning({ id: signIns.id })
        .all().length > 0,

    deny: (id: string) =>
      db.delete(signIns).where(pendingWhere(id)).returning({ id: signIns.id }).all().length > 0,

    // Takes the sign-in a code is for, once: it is gone whatever the client does with it.
    takeByCode: (codeHash: string) =>
      db
        .delete(signIns)
        .where(and(eq(signIns.codeHash, codeHash), gt(signIns.expiresAt, new Date())))
        .returning()
        .get(),
  };
}

export type SignInsRepository = ReturnType<typeof createSignInsRepository>;
