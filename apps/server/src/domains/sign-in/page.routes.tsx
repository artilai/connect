/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { z } from "zod";

import type { Hosts } from "../../platform/http/hosts";
import type { AgentsService } from "../agents/service";
import { ExpiredPage, SignInPage } from "./page";
import type { PasswordCheck } from "./password";
import type { SignInRecord } from "./schema";
import type { SignInsService } from "./service";

const decisionSchema = z.object({
  decision: z.enum(["allow", "deny"]),
  agent: z.string().optional(),
  password: z.string().optional(),
});

type CreateSignInPageRoutesOptions = {
  signIns: SignInsService;
  agents: AgentsService;
  password: PasswordCheck;
  hosts: Hosts;
};

function describeClient({ kind, clientName }: SignInRecord) {
  return kind === "cli" ? `The artil CLI on ${clientName}` : clientName;
}

// The page a person picks the agent on for a client that signs in, and proves they run the server
// with its password when it has one.
export function createSignInPageRoutes({
  signIns,
  agents,
  password,
  hosts,
}: CreateSignInPageRoutesOptions) {
  type RenderPageOptions = {
    signIn: SignInRecord;
    selectedAgentId: string | undefined;
    error?: string;
  };

  async function renderPage({ signIn, selectedAgentId, error }: RenderPageOptions) {
    return (
      <SignInPage
        client={describeClient(signIn)}
        redirectHost={new URL(signIn.redirectUri).host || signIn.redirectUri}
        agents={agents.list()}
        selectedAgentId={selectedAgentId}
        askPassword={await password.required()}
        error={error}
      />
    );
  }

  type RedirectUrlOptions = {
    signIn: SignInRecord;
    origin: string;
    params: Record<string, string>;
  };

  // The code, or the refusal, goes back to the client the way OAuth sends it.
  function redirectUrl({ signIn, origin, params }: RedirectUrlOptions) {
    const redirect = new URL(signIn.redirectUri);

    if (signIn.state !== null) redirect.searchParams.set("state", signIn.state);

    if (signIn.kind === "oauth") redirect.searchParams.set("iss", origin);

    for (const [name, value] of Object.entries(params)) redirect.searchParams.set(name, value);

    return redirect.href;
  }

  return (
    new Hono()
      .use(async (c, next) => {
        c.header("Cache-Control", "no-store");
        c.header("X-Frame-Options", "DENY");
        await next();
      })
      .get("/:id", async (c) => {
        const signIn = signIns.findPending(c.req.param("id"));

        if (!signIn) return c.html(<ExpiredPage />, 404);

        // The CLI names the agent it signs in as, which the page then selects.
        const account = c.req.query("account");

        const selectedAgentId =
          account === undefined ? undefined : agents.findByIdOrName(account)?.id;

        return c.html(await renderPage({ signIn, selectedAgentId }));
      })
      // Only the page itself posts a decision, from the address the server answers at.
      .post(
        "/:id",
        csrf({ origin: (origin, c) => origin === hosts.requestOrigin(c.req.raw) }),
        async (c) => {
          const signIn = signIns.findPending(c.req.param("id"));

          if (!signIn) return c.html(<ExpiredPage />, 404);

          const form = decisionSchema.safeParse(await c.req.parseBody());
          const origin = hosts.requestOrigin(c.req.raw);

          if (!form.success || form.data.decision === "deny") {
            signIns.deny(signIn.id);

            return c.redirect(
              redirectUrl({ signIn, origin, params: { error: "access_denied" } }),
              303,
            );
          }

          const agent =
            form.data.agent === undefined ? undefined : agents.findById(form.data.agent);

          if (!agent)
            return c.html(
              await renderPage({ signIn, selectedAgentId: undefined, error: "Pick an agent" }),
              400,
            );

          const passwordResult = await password.check(form.data.password ?? "");

          if (passwordResult !== "right") {
            const error =
              passwordResult === "wrong"
                ? "Wrong password"
                : "Too many wrong passwords; wait a minute and try again";

            return c.html(
              await renderPage({ signIn, selectedAgentId: agent.id, error }),
              passwordResult === "wrong" ? 401 : 429,
            );
          }

          const code = signIns.approve({ id: signIn.id, agentId: agent.id });

          if (!code) return c.html(<ExpiredPage />, 404);

          return c.redirect(redirectUrl({ signIn, origin, params: { code } }), 303);
        },
      )
  );
}
