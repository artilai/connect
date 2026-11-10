import { asc, eq, sql } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { accounts } from "../../platform/db/schema";

type CreateOptions = { id: string; name: string };

type RenameOptions = { id: string; name: string };

export function createAccountsRepository(db: Database) {
  function findById(id: string) {
    return db.select().from(accounts).where(eq(accounts.id, id)).get();
  }

  // An account goes by its id or, in any case, its name.
  function findByIdOrName(idOrName: string) {
    const lowercase = idOrName.trim().toLowerCase();

    return (
      findById(lowercase) ??
      db
        .select()
        .from(accounts)
        .where(eq(sql`lower(${accounts.name})`, lowercase))
        .get()
    );
  }

  return {
    findById,

    findByIdOrName,

    // In the order they were made.
    list: () =>
      db
        .select()
        .from(accounts)
        .orderBy(asc(accounts.createdAt), sql`rowid`)
        .all(),

    create: ({ id, name }: CreateOptions) =>
      db.insert(accounts).values({ id, name }).returning().get(),

    rename: ({ id, name }: RenameOptions) => {
      db.update(accounts).set({ name }).where(eq(accounts.id, id)).run();
    },

    remove: (id: string) =>
      db.delete(accounts).where(eq(accounts.id, id)).returning({ id: accounts.id }).all().length >
      0,
  };
}

export type AccountsRepository = ReturnType<typeof createAccountsRepository>;
