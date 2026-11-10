import { and, asc, eq, sql } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { agents, tokens } from "../../platform/db/schema";

type CreateOptions = { agentId: string; name: string; hash: string };

type RevokeByNameOptions = { agentId: string; name: string };

export function createTokensRepository(db: Database) {
  return {
    create: ({ agentId, name, hash }: CreateOptions) => {
      db.insert(tokens).values({ agentId, name, hash }).run();
    },

    // Who a token signs in as.
    findByHash: (hash: string) =>
      db
        .select({ agentId: tokens.agentId, name: tokens.name, agentName: agents.name })
        .from(tokens)
        .innerJoin(agents, eq(agents.id, tokens.agentId))
        .where(eq(tokens.hash, hash))
        .get(),

    // The clients the agent is signed in to, in the order they signed in.
    listByAgent: (agentId: string) =>
      db
        .select({ id: tokens.id, name: tokens.name, createdAt: tokens.createdAt })
        .from(tokens)
        .where(eq(tokens.agentId, agentId))
        .orderBy(asc(tokens.createdAt))
        .all(),

    revokeByHash: (hash: string) =>
      db.delete(tokens).where(eq(tokens.hash, hash)).returning({ id: tokens.id }).all().length > 0,

    // Signs the agent out of the clients of that name, in any case, and counts them.
    revokeByName: ({ agentId, name }: RevokeByNameOptions) =>
      db
        .delete(tokens)
        .where(
          and(
            eq(tokens.agentId, agentId),
            eq(sql`lower(${tokens.name})`, name.trim().toLowerCase()),
          ),
        )
        .returning({ id: tokens.id })
        .all().length,

    revokeByAgent: (agentId: string) =>
      db.delete(tokens).where(eq(tokens.agentId, agentId)).returning({ id: tokens.id }).all()
        .length,
  };
}

export type TokensRepository = ReturnType<typeof createTokensRepository>;
