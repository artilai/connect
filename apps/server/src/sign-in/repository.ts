import { and, count, eq, gt, isNull, lt } from "drizzle-orm";

import { AppError } from "@artil/errors";

import type { Database } from "../db/connection";
import { signIns } from "../db/schema";
import type { TokensRepository } from "../tokens/repository";
import { hashToken, randomSecret } from "../tokens/token";

export type SignInRecord = typeof signIns.$inferSelect;

// Anyone who reaches the server may ask to sign in, so the sign-ins waiting at once are capped.
const maxPending = 500;

export type NewSignIn = Omit<typeof signIns.$inferInsert, "id" | "agentId" | "codeHash">;

type ApproveOptions = { id: string; agentId: string };

type ExchangeOptions = {
  kind: SignInRecord["kind"];
  code: string;
  challenge: string;
  redirectUri: string;
  clientId?: string;
  tokenHash: string;
};

type CreateSignInsRepositoryOptions = { db: Database; tokens: TokensRepository };

// What a client signing in through the CLI is named, the way Artil Cloud names it.
function tokenNameFor({ kind, clientName }: SignInRecord) {
  return kind === "cli" ? `artil on ${clientName}` : clientName;
}

export function createSignInsRepository({ db, tokens }: CreateSignInsRepositoryOptions) {
  function pendingWhere(id: string) {
    return and(eq(signIns.id, id), isNull(signIns.codeHash), gt(signIns.expiresAt, new Date()));
  }

  return {
    create(signIn: NewSignIn) {
      db.delete(signIns).where(lt(signIns.expiresAt, new Date())).run();

      const pendingCount = db.select({ count: count() }).from(signIns).get()?.count ?? 0;

      if (pendingCount >= maxPending) {
        throw new AppError({
          code: "rate_limited",
          message: "Too many sign-ins are waiting; try again in a few minutes",
        });
      }

      return db.insert(signIns).values(signIn).returning().get();
    },

    findPending: (id: string) => db.select().from(signIns).where(pendingWhere(id)).get(),

    // Gives the sign-in its agent and returns the code the client trades for a token.
    approve({ id, agentId }: ApproveOptions) {
      const code = randomSecret();

      const approved = db
        .update(signIns)
        .set({ agentId, codeHash: hashToken(code) })
        .where(pendingWhere(id))
        .returning({ id: signIns.id })
        .all();

      return approved.length > 0 ? code : undefined;
    },

    deny: (id: string) =>
      db.delete(signIns).where(pendingWhere(id)).returning({ id: signIns.id }).all().length > 0,

    // Trades a code once for a token of the agent chosen, if the client proves it asked for it.
    exchange({ kind, code, challenge, redirectUri, clientId, tokenHash }: ExchangeOptions) {
      return db.transaction((tx) => {
        const signIn = tx
          .select()
          .from(signIns)
          .where(and(eq(signIns.codeHash, hashToken(code)), gt(signIns.expiresAt, new Date())))
          .get();

        if (!signIn) return false;

        // A code works once, whether or not the client proves it asked for it.
        tx.delete(signIns).where(eq(signIns.id, signIn.id)).run();

        const matchesRequest =
          signIn.kind === kind &&
          signIn.challenge === challenge &&
          signIn.redirectUri === redirectUri &&
          (clientId === undefined || signIn.clientId === clientId);

        if (!matchesRequest || signIn.agentId === null) return false;

        tokens.create({ agentId: signIn.agentId, name: tokenNameFor(signIn), hash: tokenHash });

        return true;
      });
    },
  };
}

export type SignInsRepository = ReturnType<typeof createSignInsRepository>;
