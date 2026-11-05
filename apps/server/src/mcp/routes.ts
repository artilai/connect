import { createMcpHandler } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import type { AuthEnv, AuthMiddleware } from "../auth/middleware";
import type { Hosts } from "../http/hosts";
import { buildOAuthUrls } from "../sign-in/oauth";
import { createMcpServer } from "./tools";

type CreateMcpRoutesOptions = Parameters<typeof createMcpServer>[0] & {
  auth: AuthMiddleware;
  hosts: Hosts;
};

const methodNotAllowed = {
  jsonrpc: "2.0",
  error: { code: -32000, message: "Method not allowed." },
  id: null,
};

export function createMcpRoutes({ auth, hosts, ...dependencies }: CreateMcpRoutesOptions) {
  return new Hono<AuthEnv>()
    .use(cors({ origin: "*", exposeHeaders: ["WWW-Authenticate", "Mcp-Protocol-Version"] }))
    .use(async (c, next) => {
      await next();

      // An MCP client without a token learns here where to sign in.
      if (c.res.status === 401) {
        const { resourceMetadata } = buildOAuthUrls(hosts.requestOrigin(c.req.raw));

        c.header("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadata}"`);
      }
    }, auth)
    .post("/", (c) =>
      createMcpHandler(() => createMcpServer(dependencies, c.var.actor)).fetch(c.req.raw),
    )
    .on(["GET", "DELETE"], "/", (c) => c.json(methodNotAllowed, 405, { allow: "POST" }));
}
