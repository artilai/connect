import type { MiddlewareHandler } from "hono";

import type { AuthEnv } from "./schema";
import type { TokensService } from "./service";

export type AuthMiddleware = MiddlewareHandler<AuthEnv>;

export function requireAuth(tokens: TokensService): AuthMiddleware {
  return async (c, next) => {
    c.set("actor", tokens.authenticate(c.req.header("authorization")));
    await next();
  };
}
