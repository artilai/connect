import { and, asc, eq, sql } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { accounts, tokens } from "../../platform/db/schema";

type CreateOptions = { accountId: string; name: string; hash: string };

type RevokeByNameOptions = { accountId: string; name: string };

export function createTokensRepository(db: Database) {
  return {
    create: ({ accountId, name, hash }: CreateOptions) => {
      db.insert(tokens).values({ accountId, name, hash }).run();
    },

    // Who a token signs in as.
    findByHash: (hash: string) =>
      db
        .select({ accountId: tokens.accountId, name: tokens.name, accountName: accounts.name })
        .from(tokens)
        .innerJoin(accounts, eq(accounts.id, tokens.accountId))
        .where(eq(tokens.hash, hash))
        .get(),

    // The clients the account is signed in to, in the order they signed in.
    listByAccount: (accountId: string) =>
      db
        .select({ id: tokens.id, name: tokens.name, createdAt: tokens.createdAt })
        .from(tokens)
        .where(eq(tokens.accountId, accountId))
        .orderBy(asc(tokens.createdAt))
        .all(),

    revokeByHash: (hash: string) =>
      db.delete(tokens).where(eq(tokens.hash, hash)).returning({ id: tokens.id }).all().length > 0,

    // Signs the account out of the clients of that name, in any case, and counts them.
    revokeByName: ({ accountId, name }: RevokeByNameOptions) =>
      db
        .delete(tokens)
        .where(
          and(
            eq(tokens.accountId, accountId),
            eq(sql`lower(${tokens.name})`, name.trim().toLowerCase()),
          ),
        )
        .returning({ id: tokens.id })
        .all().length,

    revokeByAccount: (accountId: string) =>
      db.delete(tokens).where(eq(tokens.accountId, accountId)).returning({ id: tokens.id }).all()
        .length,
  };
}

export type TokensRepository = ReturnType<typeof createTokensRepository>;
