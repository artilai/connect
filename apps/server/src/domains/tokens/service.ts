import { AppError } from "@artil/errors";

import { hashSecret } from "../../platform/crypto";
import type { TokensRepository } from "./repository";
import type { Actor } from "./schema";
import { mintToken, readToken } from "./token";

type CreateTokensServiceOptions = { tokensRepository: TokensRepository };

type IssueOptions = { agentId: string; name: string };

export function createTokensService({ tokensRepository }: CreateTokensServiceOptions) {
  return {
    // Makes a token for the agent and returns it; only its hash is kept.
    issue(options: IssueOptions) {
      const { token, hash } = mintToken();

      tokensRepository.create({ ...options, hash });

      return token;
    },

    // Who a request's bearer token signs in as.
    authenticate(authorization: string | undefined): Actor {
      const token = readToken(authorization);
      const hash = token && hashSecret(token);
      const signedInAgent = hash && tokensRepository.findByHash(hash);

      if (!hash || !signedInAgent) {
        throw new AppError({
          code: "unauthorized",
          message: token ? "Invalid access token" : "Sign in with a bearer token",
        });
      }

      return {
        agentId: signedInAgent.agentId,
        agentName: signedInAgent.agentName,
        tokenHash: hash,
        tokenName: signedInAgent.name,
      };
    },

    isValid: (hash: string) => tokensRepository.findByHash(hash) !== undefined,
    listByAgent: tokensRepository.listByAgent,
    revokeByHash: tokensRepository.revokeByHash,
    revokeByName: tokensRepository.revokeByName,
    revokeByAgent: tokensRepository.revokeByAgent,
  };
}

export type TokensService = ReturnType<typeof createTokensService>;
