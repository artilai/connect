import { eq } from "drizzle-orm";

import type { Database } from "../db/connection";
import { agents, tokens } from "../db/schema";
import { mintToken } from "./token";

type IssueOptions = { agentId: string; name: string };

type CreateOptions = IssueOptions & { hash: string };

export function createTokensRepository(db: Database) {
  function create({ agentId, name, hash }: CreateOptions) {
    db.insert(tokens).values({ agentId, name, hash }).run();
  }

  return {
    // Makes a token for the agent and returns it; only its hash is kept.
    issue(options: IssueOptions) {
      const { token, hash } = mintToken();

      create({ ...options, hash });

      return token;
    },

    create,

    // Who a token signs in as, noting that it was used.
    findByHash(hash: string) {
      const signedInAgent = db
        .select({ agentId: tokens.agentId, name: tokens.name, agentName: agents.name })
        .from(tokens)
        .innerJoin(agents, eq(agents.id, tokens.agentId))
        .where(eq(tokens.hash, hash))
        .get();

      if (signedInAgent) {
        db.update(tokens).set({ lastUsedAt: new Date() }).where(eq(tokens.hash, hash)).run();
      }

      return signedInAgent;
    },

    revokeByHash: (hash: string) =>
      db.delete(tokens).where(eq(tokens.hash, hash)).returning({ id: tokens.id }).all().length > 0,

    revokeByAgent: (agentId: string) =>
      db.delete(tokens).where(eq(tokens.agentId, agentId)).returning({ id: tokens.id }).all()
        .length,
  };
}

export type TokensRepository = ReturnType<typeof createTokensRepository>;
