import { AppError } from "@artil/errors";

import { hashSecret } from "../../platform/crypto";
import type { TokensRepository } from "./repository";
import type { Actor } from "./schema";
import { mintToken, readToken } from "./token";

type CreateTokensServiceOptions = { tokensRepository: TokensRepository };

type IssueOptions = { accountId: string; name: string };

export function createTokensService({ tokensRepository }: CreateTokensServiceOptions) {
  return {
    // Makes a token for the account and returns it; only its hash is kept.
    issue(options: IssueOptions) {
      const { token, hash } = mintToken();

      tokensRepository.create({ ...options, hash });

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

    isValid: (hash: string) => tokensRepository.findByHash(hash) !== undefined,
    listByAccount: tokensRepository.listByAccount,
    revokeByHash: tokensRepository.revokeByHash,
    revokeByName: tokensRepository.revokeByName,
    revokeByAccount: tokensRepository.revokeByAccount,
  };
}

export type TokensService = ReturnType<typeof createTokensService>;
