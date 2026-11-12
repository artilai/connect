import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";

import { AppError } from "@artil/errors";

import { loadAccount } from "../domains/accounts/middleware";
import { createAccountRoutes } from "../domains/accounts/routes";
import { createAddressRoutes } from "../domains/addresses/routes";
import { createChannelRoutes } from "../domains/channels/agent.routes";
import { createProviderRoutes } from "../domains/channels/provider.routes";
import { createConnectionRoutes } from "../domains/connections/routes";
import { createEventRoutes } from "../domains/events/routes";
import { createFileRoutes } from "../domains/files/routes";
import { createMeRoutes } from "../domains/me/routes";
import { createMessageUrlRoutes } from "../domains/messages/message-url.routes";
import { createMessageRoutes } from "../domains/messages/routes";
import { createCliSignInRoutes } from "../domains/sign-in/cli.routes";
import { createOAuthMetadataRoutes, createOAuthRoutes } from "../domains/sign-in/oauth.routes";
import { createSignInPageRoutes } from "../domains/sign-in/page.routes";
import type { PasswordCheck } from "../domains/sign-in/password";
import { createTeamRoutes } from "../domains/team/routes";
import { requireAuth } from "../domains/tokens/middleware";
import type { AuthEnv } from "../domains/tokens/schema";
import { createWebhookRoutes } from "../domains/webhooks/routes";
import { loginCommand } from "../platform/artil-cli";
import type { Hosts } from "../platform/http/hosts";
import { describeApi } from "../platform/http/openapi";
import { createMcpRoutes } from "./mcp";
import type { Services } from "./services";

type CreateAppOptions = {
  services: Services;
  hosts: Hosts;
  password: PasswordCheck;
  workspace: { id: string; name: string; ownerId: string };
  log: (line: string) => void;
};

// How the server greets a visit to its root, which tells artil-connect status that it runs.
export const runningGreeting = "Artil Connect is running.";

function notFound(method: string, path: string): never {
  throw new AppError({ code: "not_found", message: `There is no endpoint for ${method} ${path}` });
}

// The API the CLI calls, documented as the part of the Artil API this server answers.
function createApi({ services, workspace }: Pick<CreateAppOptions, "services" | "workspace">) {
  // An account's own routes take only its own token.
  const ownRoutes = new Hono<AuthEnv>()
    .use(loadAccount(services.accounts))
    .route("/addresses", createAddressRoutes(services))
    .route("/channels", createChannelRoutes(services))
    .route("/connection", createConnectionRoutes(services))
    .route("/events", createEventRoutes(services))
    .route("/messages", createMessageRoutes(services))
    .route("/", createWebhookRoutes());

  const accountRoutes = new Hono<AuthEnv>()
    .route("/", createAccountRoutes(services))
    .route("/:id", ownRoutes);

  return new Hono<AuthEnv>()
    .use(requireAuth(services.tokens))
    .route("/agents", accountRoutes)
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
    .route("/channels", createProviderRoutes({ ...services, receive: services.messages.receive }))
    .route("/", api)
    .all("*", (c) => notFound(c.req.method, c.req.path));

  return (
    new Hono()
      .onError(errorResponse)
      .use(hosts.check, secureHeaders())
      .route("/api", apiRoot)
      .route("/a", createMessageUrlRoutes({ ...services, auth: requireAuth(services.tokens) }))
      .route("/mcp", createMcpRoutes({ services, auth: requireAuth(services.tokens), hosts, log }))
      .route("/.well-known", createOAuthMetadataRoutes({ hosts }))
      .route("/oauth", createOAuthRoutes({ signIns: services.signIns, hosts }))
      .route("/sign-in", createSignInPageRoutes({ ...services, password, hosts }))
      // The CLI opens the sign-in page here, as it does on Artil Cloud.
      .get("/cli/authorize/:id", (c) => {
        const query = new URL(c.req.url).search;

        return c.redirect(`/sign-in/${encodeURIComponent(c.req.param("id"))}${query}`);
      })
      // The CLI links an account's page, which this server has no app for.
      .get("/accounts/*", (c) =>
        c.text(
          "This server has no web app. Manage its accounts with artil-connect; see artil-connect --help.\n",
        ),
      )
      .get("/", (c) =>
        c.text(
          `${runningGreeting} Sign in as an account with:\n\n  ${loginCommand(hosts.requestOrigin(c.req.raw))}\n`,
        ),
      )
      .all("*", (c) => notFound(c.req.method, c.req.path))
  );
}
