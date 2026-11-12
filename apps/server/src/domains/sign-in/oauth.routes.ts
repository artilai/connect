import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import { AppError } from "@artil/errors";
import { minute } from "@artil/utils/time";

import type { Hosts } from "../../platform/http/hosts";
import { validateQuery } from "../../platform/http/validate";
import { allowsRedirect, readClient, registeredClientId, registrationSchema } from "./clients";
import type { SignInsService } from "./service";

const requestLifetime = 10 * minute;

const authorizeSchema = z.object({
  response_type: z.literal("code", "response_type must be code"),
  client_id: z.string(),
  redirect_uri: z.string(),
  code_challenge: z
    .string()
    .regex(/^[A-Za-z0-9_\-]{43}$/v, "code_challenge must be an S256 PKCE challenge"),
  code_challenge_method: z.literal("S256", "code_challenge_method must be S256"),
  state: z.string().max(1024).exactOptional(),
  resource: z.string().exactOptional(),
});

const tokenSchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string(),
  code_verifier: z.string().regex(/^[A-Za-z0-9._~\-]{43,128}$/v),
  client_id: z.string(),
  redirect_uri: z.string(),
  resource: z.string().exactOptional(),
});

type OAuthErrorCode =
  | "invalid_request"
  | "invalid_grant"
  | "invalid_target"
  | "invalid_redirect_uri"
  | "invalid_client_metadata";

function oauthError(error: OAuthErrorCode, description: string) {
  return { error, error_description: description };
}

const validateTokenRequest = zValidator("form", tokenSchema, (result, c) =>
  result.success
    ? undefined
    : c.json(oauthError("invalid_request", "The token request is malformed"), 400),
);

const validateRegistration = zValidator("json", registrationSchema, (result, c) => {
  if (result.success) return undefined;

  const [issue] = result.error.issues;

  return issue?.path[0] === "redirect_uris"
    ? c.json(oauthError("invalid_redirect_uri", issue.message), 400)
    : c.json(oauthError("invalid_client_metadata", issue?.message ?? "Invalid client"), 400);
});

// Where the server signs MCP clients in, at the address the client reached it at.
export function buildOAuthUrls(origin: string) {
  return {
    issuer: origin,
    resource: `${origin}/mcp`,
    resourceMetadata: `${origin}/.well-known/oauth-protected-resource/mcp`,
  };
}

type CreateOAuthRoutesOptions = { signIns: SignInsService; hosts: Hosts };

// MCP clients sign in with OAuth: they register themselves, send the person to the sign-in page,
// and trade the code it gives them for a token of the account the person picked.
export function createOAuthRoutes({ signIns, hosts }: CreateOAuthRoutesOptions) {
  function urlsOf(c: Context) {
    return buildOAuthUrls(hosts.requestOrigin(c.req.raw));
  }

  return new Hono()
    .use(async (c, next) => {
      c.header("Cache-Control", "no-store");
      await next();
    })
    .use("/register", cors())
    .use("/token", cors())
    .post("/register", validateRegistration, (c) => {
      const registration = c.req.valid("json");

      return c.json(
        {
          client_id: registeredClientId(registration),
          client_id_issued_at: Math.floor(Date.now() / 1000),
          ...registration,
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        },
        201,
      );
    })
    .get("/authorize", validateQuery(authorizeSchema), (c) => {
      const query = c.req.valid("query");
      const urls = urlsOf(c);

      if ((query.resource ?? urls.resource) !== urls.resource) {
        throw new AppError({ code: "invalid_input", message: `resource must be ${urls.resource}` });
      }

      const client = readClient(query.client_id);

      if (!allowsRedirect(client, query.redirect_uri)) {
        throw new AppError({
          code: "invalid_input",
          message: `${client.name} did not list ${query.redirect_uri} among its redirect URIs`,
        });
      }

      const { id } = signIns.create({
        kind: "oauth",
        clientId: client.id,
        clientName: client.name,
        redirectUri: query.redirect_uri,
        challenge: query.code_challenge,
        state: query.state ?? null,
        expiresAt: new Date(Date.now() + requestLifetime),
      });

      return c.redirect(`/sign-in/${id}`);
    })
    .post("/token", validateTokenRequest, (c) => {
      const request = c.req.valid("form");
      const { resource } = urlsOf(c);

      if ((request.resource ?? resource) !== resource) {
        return c.json(oauthError("invalid_target", `resource must be ${resource}`), 400);
      }

      const token = signIns.exchange({
        kind: "oauth",
        code: request.code,
        verifier: request.code_verifier,
        clientId: request.client_id,
        redirectUri: request.redirect_uri,
      });

      if (!token) {
        return c.json(
          oauthError("invalid_grant", "The code is invalid, expired or already used"),
          400,
        );
      }

      return c.json({ access_token: token, token_type: "Bearer" });
    });
}

type CreateOAuthMetadataRoutesOptions = { hosts: Hosts };

export function createOAuthMetadataRoutes({ hosts }: CreateOAuthMetadataRoutesOptions) {
  function protectedResource(c: Context) {
    const { issuer, resource } = buildOAuthUrls(hosts.requestOrigin(c.req.raw));

    return c.json({
      resource,
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
      resource_name: "Artil Connect",
    });
  }

  function authorizationServer(c: Context) {
    const { issuer } = buildOAuthUrls(hosts.requestOrigin(c.req.raw));

    return c.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
    });
  }

  // Clients look for these documents at different paths, so each is served at all of them.
  return new Hono()
    .use(cors())
    .get("/oauth-protected-resource/mcp", protectedResource)
    .get("/oauth-protected-resource", protectedResource)
    .get("/oauth-authorization-server", authorizationServer)
    .get("/oauth-authorization-server/mcp", authorizationServer)
    .get("/openid-configuration", authorizationServer)
    .get("/openid-configuration/mcp", authorizationServer);
}
