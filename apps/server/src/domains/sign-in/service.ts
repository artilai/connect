import { AppError } from "@artil/errors";

import { hashSecret, pkceChallenge, randomSecret } from "../../platform/crypto";
import type { TokensService } from "../tokens/service";
import type { SignInsRepository } from "./repository";
import type { NewSignIn, SignInRecord } from "./schema";

// Anyone who reaches the server may ask to sign in, so the sign-ins waiting at once are capped.
const maxPending = 500;

type CreateSignInsServiceOptions = { signInsRepository: SignInsRepository; tokens: TokensService };

type ApproveOptions = { id: string; accountId: string };

type ExchangeOptions = {
  kind: SignInRecord["kind"];
  code: string;
  verifier: string;
  redirectUri: string;
  clientId?: string;
};

// What a client signing in through the CLI is named, the way Artil Cloud names it.
function tokenNameFor({ kind, clientName }: SignInRecord) {
  return kind === "cli" ? `artil on ${clientName}` : clientName;
}

export function createSignInsService({ signInsRepository, tokens }: CreateSignInsServiceOptions) {
  return {
    create(signIn: NewSignIn) {
      signInsRepository.removeExpired();

      if (signInsRepository.count() >= maxPending) {
        throw new AppError({
          code: "rate_limited",
          message: "Too many sign-ins are waiting; try again in a few minutes",
        });
      }

      return signInsRepository.create(signIn);
    },

    findPending: signInsRepository.findPending,
    deny: signInsRepository.deny,

    // Gives the sign-in its account and returns the code the client trades for a token.
    approve({ id, accountId }: ApproveOptions) {
      const code = randomSecret();

      return signInsRepository.approve({ id, accountId, codeHash: hashSecret(code) })
        ? code
        : undefined;
    },

    // Trades a code once for a token of the account chosen, if the client proves it asked for it.
    exchange({ kind, code, verifier, redirectUri, clientId }: ExchangeOptions) {
      const signIn = signInsRepository.takeByCode(hashSecret(code));

      const matchesRequest =
        signIn?.kind === kind &&
        signIn.challenge === pkceChallenge(verifier) &&
        signIn.redirectUri === redirectUri &&
        signIn.clientId === (clientId ?? signIn.clientId);

      if (!matchesRequest || signIn.accountId === null) return undefined;

      return tokens.issue({ accountId: signIn.accountId, name: tokenNameFor(signIn) });
    },
  };
}

export type SignInsService = ReturnType<typeof createSignInsService>;
