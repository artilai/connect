import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { jsonResponse } from "../../platform/http/openapi";
import type { AuthEnv } from "../tokens/schema";
import type { TokensService } from "../tokens/service";

const signedIn = {
  orgId: z.uuid(),
  workspace: z.object({ name: z.string().nullable() }),
  agent: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .describe("The agent the token acts as, or null for a member"),
};

// The shape and words are Artil Cloud's, which clients compare oneOf variants by; the member half
// stays for them, though this server signs accounts in only.
const meSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("member"),
      userId: z.uuid(),
      role: z.enum(["admin", "member"]),
      email: z.string().nullable().describe("The member's email address"),
      ...signedIn,
    }),
    z.object({
      kind: z.literal("identity"),
      identityId: z.string(),
      // Whoever set the server up, who approves every sign-in.
      signedInBy: z
        .uuid()
        .describe("The member who made the token, such as by approving a sign-in"),
      ...signedIn,
    }),
  ])
  .meta({ id: "Me" });

type Me = z.infer<typeof meSchema>;

const tags = ["Me"];

const docs = {
  revokeToken: describeRoute({
    tags,
    operationId: "revokeOwnToken",
    summary: "Revoke this token",
    description: "Revoke the token this request signs in with.",
    responses: { 204: { description: "The token no longer works" } },
  }),
  read: describeRoute({
    tags,
    operationId: "readMe",
    summary: "Read who is signed in",
    description: "Read the agent the token signs in as, and the server's workspace.",
    responses: { 200: jsonResponse("The signed-in agent", meSchema) },
  }),
};

type CreateMeRoutesOptions = {
  tokens: TokensService;
  workspace: { id: string; name: string; ownerId: string };
};

export function createMeRoutes({ tokens, workspace }: CreateMeRoutesOptions) {
  return new Hono<AuthEnv>()
    .delete("/token", docs.revokeToken, (c) => {
      tokens.revokeByHash(c.var.actor.tokenHash);

      return c.body(null, 204);
    })
    .get("/", docs.read, (c) => {
      const { accountId, accountName } = c.var.actor;

      return c.json({
        kind: "identity",
        identityId: accountId,
        signedInBy: workspace.ownerId,
        orgId: workspace.id,
        workspace: { name: workspace.name },
        agent: { id: accountId, name: accountName },
      } satisfies Me);
    });
}
