import { asc, eq, inArray } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { accounts, tokens } from "../../platform/db/schema";

type ReplaceByNameOptions = { accountId: string; name: string; hash: string };

type ListByNameOptions = { accountId: string; name: string };

// A transaction a sign-in is replaced in.
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// The account's sign-ins that go by a name a person gives, in any case. JavaScript folds the case, as
// SQLite folds only ASCII, so what a command finds is what it revokes.
function signInsNamed(reader: Database | Transaction, { accountId, name }: ListByNameOptions) {
  const wanted = name.trim().toLowerCase();

  return reader
    .select({ id: tokens.id, name: tokens.name, createdAt: tokens.createdAt })
    .from(tokens)
    .where(eq(tokens.accountId, accountId))
    .all()
    .filter((signIn) => signIn.name.toLowerCase() === wanted);
}

export function createTokensRepository(db: Database) {
  return {
    // Signs the account in by the name, in place of its sign-ins of that name, holding the write
    // lock from the first read, so two at once still leave one.
    replaceByName: ({ accountId, name, hash }: ReplaceByNameOptions) =>
      db.transaction(
        (tx) => {
          const replaced = signInsNamed(tx, { accountId, name }).map(({ id }) => id);

          if (replaced.length > 0) tx.delete(tokens).where(inArray(tokens.id, replaced)).run();

          tx.insert(tokens).values({ accountId, name, hash }).run();
        },
        { behavior: "immediate" },
      ),

    listByName: (options: ListByNameOptions) => signInsNamed(db, options),

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

    // Signs out the clients of these sign-ins, and counts them.
    revokeByIds: (ids: readonly string[]) =>
      db
        .delete(tokens)
        .where(inArray(tokens.id, [...ids]))
        .returning({ id: tokens.id })
        .all().length,

    revokeByAccount: (accountId: string) =>
      db.delete(tokens).where(eq(tokens.accountId, accountId)).returning({ id: tokens.id }).all()
        .length,
  };
}

export type TokensRepository = ReturnType<typeof createTokensRepository>;
