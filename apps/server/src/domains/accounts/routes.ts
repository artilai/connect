import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { jsonResponse } from "../../platform/http/openapi";
import type { AuthEnv } from "../tokens/schema";
import { loadAccount } from "./middleware";
import { accountSchema, toAccount } from "./schema";
import type { AccountsService } from "./service";

const tags = ["Agents"];

const docs = {
  list: describeRoute({
    tags,
    operationId: "listAgents",
    summary: "List agents",
    description: "List the server's agents.",
    responses: { 200: jsonResponse("The agents", z.array(accountSchema)) },
  }),
  read: describeRoute({
    tags,
    operationId: "readAgent",
    summary: "Read an agent",
    responses: { 200: jsonResponse("The agent", accountSchema) },
  }),
};

type CreateAccountRoutesOptions = { accounts: AccountsService };

export function createAccountRoutes({ accounts }: CreateAccountRoutesOptions) {
  return new Hono<AuthEnv>()
    .get("/", docs.list, (c) => c.json(accounts.list().map(toAccount)))
    .get("/:id", docs.read, loadAccount(accounts), (c) => c.json(toAccount(c.var.account)));
}
