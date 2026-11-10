import { createMiddleware } from "hono/factory";

import { AppError } from "@artil/errors";

import type { AccountEnv } from "./schema";
import type { AccountsService } from "./service";

// An account's own routes take only its own token.
export function loadAccount(accounts: AccountsService) {
  return createMiddleware<AccountEnv>(async (c, next) => {
    const id = c.req.param("id")?.toLowerCase();
    const account = id === c.var.actor.accountId ? accounts.findById(id) : undefined;

    if (!account) throw new AppError({ code: "not_found", message: "Agent account not found" });

    c.set("account", account);
    await next();
  });
}
