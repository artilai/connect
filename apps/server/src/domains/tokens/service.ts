import { AppError } from "@artil/errors";

import { hashSecret } from "../../platform/crypto";
import type { TokensRepository } from "./repository";
import type { Actor } from "./schema";
import { mintToken, readToken } from "./token";

type CreateTokensServiceOptions = { tokensRepository: TokensRepository };

type IssueOptions = { accountId: string; name: string };

type ListByNameOptions = { accountId: string; name: string };

export function createTokensService({ tokensRepository }: CreateTokensServiceOptions) {
  // The account's sign-ins that go by a name a person gives, in any case. JavaScript folds the case,
  // as SQLite folds only ASCII, so what a command finds is what it revokes.
  function listByName({ accountId, name }: ListByNameOptions) {
    const wanted = name.trim().toLowerCase();

    return tokensRepository
      .listByAccount(accountId)
      .filter((signIn) => signIn.name.toLowerCase() === wanted);
  }

  return {
    // Makes a token for the account and returns it; only its hash is kept. A client signs in once:
    // signing in again by the same name, like the artil CLI on the same computer, replaces the
    // sign-in before.
    issue({ accountId, name }: IssueOptions) {
      const { token, hash } = mintToken();
      const replaced = listByName({ accountId, name }).map(({ id }) => id);

      if (replaced.length > 0) tokensRepository.revokeByIds(replaced);

      tokensRepository.create({ accountId, name, hash });

      return token;
    },

    // Who a request's bearer token signs in as.
    authenticate(authorization: string | undefined): Actor {
      const token = readToken(authorization);
      const hash = token && hashSecret(token);
      const signedInAccount = hash && tokensRepository.findByHash(hash);

      if (!hash || !signedInAccount) {
        throw new AppError({
          code: "unauthorized",
          message: token ? "Invalid access token" : "Sign in with a bearer token",
        });
      }

      return {
        accountId: signedInAccount.accountId,
        accountName: signedInAccount.accountName,
        tokenHash: hash,
        tokenName: signedInAccount.name,
      };
    },

    isValid: (hash: string) => Boolean(tokensRepository.findByHash(hash)),
    listByAccount: tokensRepository.listByAccount,

    listByName,

    revokeByHash: tokensRepository.revokeByHash,
    revokeByIds: tokensRepository.revokeByIds,
    revokeByAccount: tokensRepository.revokeByAccount,
  };
}

export type TokensService = ReturnType<typeof createTokensService>;
