import { eq } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { agents, tokens } from "../../platform/db/schema";

type CreateOptions = { agentId: string; name: string; hash: string };

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

    revokeByHash: (hash: string) =>
      db.delete(tokens).where(eq(tokens.hash, hash)).returning({ id: tokens.id }).all().length > 0,

    revokeByAgent: (agentId: string) =>
      db.delete(tokens).where(eq(tokens.agentId, agentId)).returning({ id: tokens.id }).all()
        .length,
  };
}

export type TokensRepository = ReturnType<typeof createTokensRepository>;
