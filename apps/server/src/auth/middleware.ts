import type { MiddlewareHandler } from "hono";

import { AppError } from "@artil/errors";

import type { TokensRepository } from "../tokens/repository";
import { hashToken, readToken } from "../tokens/token";

// Every token signs in as one agent; the server has no member accounts.
export type Actor = { agentId: string; agentName: string; tokenHash: string; tokenName: string };

export type AuthEnv = { Variables: { actor: Actor } };

export type AuthMiddleware = MiddlewareHandler<AuthEnv>;

export function requireAuth(tokens: TokensRepository): AuthMiddleware {
  return async (c, next) => {
    const token = readToken(c.req.header("authorization"));
    const hash = token && hashToken(token);
    const signedInAgent = hash && tokens.findByHash(hash);

    if (!hash || !signedInAgent) {
      throw new AppError({
        code: "unauthorized",
        message: token ? "Invalid access token" : "Sign in with a bearer token",
      });
    }

    c.set("actor", {
      agentId: signedInAgent.agentId,
      agentName: signedInAgent.agentName,
      tokenHash: hash,
      tokenName: signedInAgent.name,
    });

    await next();
  };
}
