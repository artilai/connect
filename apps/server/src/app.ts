import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";

import { AppError } from "@artil/errors";

import { createAgentRoutes } from "./agents/routes";
import { type AuthEnv, requireAuth } from "./auth/middleware";
import { createChannelWebhooks } from "./channels/webhooks";
import { createFileRoutes } from "./files/routes";
import type { Hosts } from "./http/hosts";
import { describeApi } from "./http/openapi";
import { createMcpRoutes } from "./mcp/routes";
import { createMeRoutes } from "./me/routes";
import type { Services } from "./services";
import { createCliSignInRoutes } from "./sign-in/cli";
import { createOAuthMetadataRoutes, createOAuthRoutes } from "./sign-in/oauth";
import type { PasswordCheck } from "./sign-in/password";
import { createSignInPageRoutes } from "./sign-in/routes";
import { createTeamRoutes } from "./team/routes";

type CreateAppOptions = {
  services: Services;
  hosts: Hosts;
  password: PasswordCheck;
  workspace: { id: string; name: string; ownerId: string };
  // The channel whose provider posts to the server; only a public server has one.
  log: (line: string) => void;
};

function notFound(method: string, path: string): never {
  throw new AppError({ code: "not_found", message: `There is no endpoint for ${method} ${path}` });
}

// The API the CLI calls, documented as the part of the Artil API this server answers.
function createApi({ services, workspace }: Pick<CreateAppOptions, "services" | "workspace">) {
  return new Hono<AuthEnv>()
    .use(requireAuth(services.tokens))
    .route("/agents", createAgentRoutes(services))
    .route("/team", createTeamRoutes(services))
    .route("/me", createMeRoutes({ tokens: services.tokens, workspace }));
}

export function createApp({ services, hosts, password, workspace, log }: CreateAppOptions) {
  const api = createApi({ services, workspace });
  let specs: ReturnType<typeof describeApi> | undefined;

  function errorResponse(cause: Error) {
    if (cause instanceof HTTPException) return cause.getResponse();

    if (!(cause instanceof AppError)) log(`Request failed: ${cause.stack ?? String(cause)}`);

    return AppError.from(cause).getResponse();
  }

  const apiRoot = new Hono()
    .onError(errorResponse)
    .get("/health", (c) => c.json({ status: "ok" }))
    .get("/openapi.json", async (c) => c.json(await (specs ??= describeApi(api))))
    .route("/cli", createCliSignInRoutes(services))
    .route("/files", createFileRoutes(services))
    .route("/channels", createChannelWebhooks(services))
    .route("/", api)
    .all("*", (c) => notFound(c.req.method, c.req.path));

  return (
    new Hono()
      .onError(errorResponse)
      .use(hosts.check, secureHeaders())
      .route("/api", apiRoot)
      // An agent's Message URL takes the same request as the route it stands for.
      .post("/a/:id", (c) => {
        const url = new URL(`/agents/${encodeURIComponent(c.req.param("id"))}/url`, c.req.url);

        return apiRoot.fetch(new Request(url.href, c.req.raw));
      })
      .route(
        "/mcp",
        createMcpRoutes({ ...services, auth: requireAuth(services.tokens), hosts, log }),
      )
      .route("/.well-known", createOAuthMetadataRoutes({ hosts }))
      .route("/oauth", createOAuthRoutes({ signIns: services.signIns, hosts }))
      .route("/sign-in", createSignInPageRoutes({ ...services, password, hosts }))
      // The CLI opens the sign-in page here, as it does on Artil Cloud.
      .get("/cli/authorize/:id", (c) => {
        const query = new URL(c.req.url).search;

        return c.redirect(`/sign-in/${encodeURIComponent(c.req.param("id"))}${query}`);
      })
      // The CLI links an agent's page, which this server has no app for.
      .get("/accounts/*", (c) =>
        c.text(
          "This server has no web app. Manage its agents with artil-server; see artil-server --help.\n",
        ),
      )
      .get("/", (c) =>
        c.text(
          `Artil server is running. Sign an agent in with:\n\n  ARTIL_BASE_URL=${hosts.requestOrigin(c.req.raw)} artil auth login\n`,
        ),
      )
      .all("*", (c) => notFound(c.req.method, c.req.path))
  );
}
