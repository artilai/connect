import { asc, eq, sql } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { agents } from "../../platform/db/schema";

type CreateOptions = { id: string; name: string };

export function createAgentsRepository(db: Database) {
  function findById(id: string) {
    return db.select().from(agents).where(eq(agents.id, id)).get();
  }

  // An agent goes by its id or, in any case, its name.
  function findByIdOrName(idOrName: string) {
    const lowercase = idOrName.trim().toLowerCase();

    return (
      findById(lowercase) ??
      db
        .select()
        .from(agents)
        .where(eq(sql`lower(${agents.name})`, lowercase))
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
        .from(agents)
        .orderBy(asc(agents.createdAt), sql`rowid`)
        .all(),

    create: ({ id, name }: CreateOptions) =>
      db.insert(agents).values({ id, name }).returning().get(),

    remove: (id: string) =>
      db.delete(agents).where(eq(agents.id, id)).returning({ id: agents.id }).all().length > 0,
  };
}

export type AgentsRepository = ReturnType<typeof createAgentsRepository>;
