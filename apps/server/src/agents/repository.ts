import { asc, eq, sql } from "drizzle-orm";

import { AppError } from "@artil/errors";

import type { Database } from "../db/connection";
import { agents } from "../db/schema";

export type AgentRecord = typeof agents.$inferSelect;

// Agent ids look like Artil Cloud's: eight characters of Crockford's base32.
const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";

function newAgentId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => alphabet[byte % 32]).join(
    "",
  );
}

const namePattern = /^[^\p{Cc}\p{Cf}]{1,80}$/v;

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

    create(name: string) {
      const trimmed = name.trim();

      if (!namePattern.test(trimmed)) {
        throw new AppError({
          code: "invalid_input",
          message: "An agent's name is 1 to 80 characters, with no control characters",
        });
      }

      if (findByIdOrName(trimmed)) {
        throw new AppError({ code: "conflict", message: `There is already an agent ${trimmed}` });
      }

      return db.insert(agents).values({ id: newAgentId(), name: trimmed }).returning().get();
    },

    remove: (id: string) =>
      db.delete(agents).where(eq(agents.id, id)).returning({ id: agents.id }).all().length > 0,
  };
}

export type AgentsRepository = ReturnType<typeof createAgentsRepository>;
