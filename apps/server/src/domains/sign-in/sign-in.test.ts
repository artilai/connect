import { expect, test } from "bun:test";

import { z } from "zod";

import { createTestServer, origin, pkce, type TestServer } from "../../app/testing";

const machine = { machineId: crypto.randomUUID(), machineName: "MacBook" };

const redirectUri = "http://127.0.0.1:53682/callback";

const state = "s".repeat(32);

type AskOptions = { server: TestServer; challenge: string };

// What the CLI does first: it asks for a sign-in and opens the page the server names.
async function askToSignIn({ server, challenge }: AskOptions) {
  const response = await server.call("/api/cli/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...machine, redirectUri, challenge, state }),
  });

  expect(response.status).toBe(201);

  return z.object({ id: z.uuid() }).parse(await response.json()).id;
}

type DecideOptions = {
  server: TestServer;
  id: string;
  fields: Record<string, string>;
  from?: string;
};

function decide({ server, id, fields, from = origin }: DecideOptions) {
  return server.call(`/sign-in/${id}`, {
    method: "POST",
    headers: { origin: from, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

type ExchangeOptions = { server: TestServer; code: string; verifier: string };

function exchange({ server, code, verifier }: ExchangeOptions) {
  return server.call("/api/cli/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, verifier, redirectUri }),
  });
}

test("signs the CLI in as the agent picked on the sign-in page", async () => {
  const server = await createTestServer();
  const codex = server.services.agents.create("Codex");

  server.services.agents.create("Claude");

  const { verifier, challenge } = pkce();
  const id = await askToSignIn({ server, challenge });

  const authorizePage = await server.call(`/cli/authorize/${id}?account=codex`);

  expect(authorizePage.status).toBe(302);
  expect(authorizePage.headers.get("location")).toBe(`/sign-in/${id}?account=codex`);

  const page = await (await server.call(`/sign-in/${id}?account=codex`)).text();

  expect(page).toContain("The artil CLI on MacBook");
  expect(page).toContain(`value="${codex.id}" checked`);
  expect(page).not.toContain('type="password"');

  const allowed = await decide({ server, id, fields: { decision: "allow", agent: codex.id } });
  const redirect = new URL(allowed.headers.get("location") ?? "");

  expect(allowed.status).toBe(303);
  expect(redirect.origin + redirect.pathname).toBe(redirectUri);
  expect(redirect.searchParams.get("state")).toBe(state);

  const code = redirect.searchParams.get("code") ?? "";
  const exchangeResponse = await exchange({ server, code, verifier });
  const { token } = z.object({ token: z.string() }).parse(await exchangeResponse.json());
  const me = await (await server.call("/api/me", { token })).json();

  expect(me).toMatchObject({
    kind: "identity",
    identityId: codex.id,
    agent: { id: codex.id, name: "Codex" },
  });

  const secondExchange = await exchange({ server, code, verifier });

  expect(secondExchange.status).toBe(401);
});

test("refuses a code traded without the verifier the sign-in was asked with", async () => {
  const server = await createTestServer();
  const agent = server.services.agents.create("Codex");
  const id = await askToSignIn({ server, challenge: pkce().challenge });
  const allowed = await decide({ server, id, fields: { decision: "allow", agent: agent.id } });
  const code = new URL(allowed.headers.get("location") ?? "").searchParams.get("code") ?? "";

  const exchangeResponse = await exchange({ server, code, verifier: pkce().verifier });

  expect(exchangeResponse.status).toBe(401);
});

test("sends a refusal back when the person denies the sign-in", async () => {
  const server = await createTestServer();

  server.services.agents.create("Codex");

  const id = await askToSignIn({ server, challenge: pkce().challenge });
  const denied = await decide({ server, id, fields: { decision: "deny" } });
  const redirect = new URL(denied.headers.get("location") ?? "");

  expect(redirect.searchParams.get("error")).toBe("access_denied");
  expect(redirect.searchParams.get("code")).toBeNull();
  expect((await server.call(`/sign-in/${id}`)).status).toBe(404);
});

test("takes a decision only from the sign-in page itself", async () => {
  const server = await createTestServer();
  const agent = server.services.agents.create("Codex");
  const id = await askToSignIn({ server, challenge: pkce().challenge });

  const forgedDecision = await decide({
    server,
    id,
    fields: { decision: "allow", agent: agent.id },
    from: "https://evil.test",
  });

  expect(forgedDecision.status).toBe(403);
});

test("asks for the server's password, and pauses after wrong guesses, even ones made at once", async () => {
  const publicUrl = "https://mac.tailnet.ts.net";
  const server = await createTestServer({ password: "correct horse", publicUrl });
  const agent = server.services.agents.create("Codex");
  const id = await askToSignIn({ server, challenge: pkce().challenge });

  expect(await (await server.call(`/sign-in/${id}`)).text()).toContain('type="password"');

  function attempt(password: string) {
    return decide({
      server,
      id,
      from: publicUrl,
      fields: { decision: "allow", agent: agent.id, password },
    });
  }

  const guesses = await Promise.all(Array.from({ length: 8 }, () => attempt("wrong")));

  expect(guesses.map(({ status }) => status).toSorted((a, b) => a - b)).toEqual([
    401, 401, 401, 401, 401, 429, 429, 429,
  ]);

  const paused = await attempt("correct horse");

  expect(paused.status).toBe(429);
  expect(await paused.text()).toContain("Too many wrong passwords");
});

test("lets the right password through, on a local server too", async () => {
  const server = await createTestServer({ password: "correct horse" });
  const agent = server.services.agents.create("Codex");
  const id = await askToSignIn({ server, challenge: pkce().challenge });

  const wrong = await decide({ server, id, fields: { decision: "allow", agent: agent.id } });

  expect(wrong.status).toBe(401);

  const allowed = await decide({
    server,
    id,
    fields: { decision: "allow", agent: agent.id, password: "correct horse" },
  });

  expect(allowed.status).toBe(303);
  expect(new URL(allowed.headers.get("location") ?? "").searchParams.get("code")).toBeString();
});

test("signs an MCP client in with OAuth, as the agent picked on the sign-in page", async () => {
  const server = await createTestServer();
  const agent = server.services.agents.create("ChatGPT agent");
  const callback = "https://chatgpt.com/connector/oauth/callback";

  const discovered = await server.call("/.well-known/oauth-authorization-server");
  const metadata = z.looseObject({ issuer: z.string(), registration_endpoint: z.string() });
  const authorizationServer = metadata.parse(await discovered.json());

  expect(authorizationServer.issuer).toBe(origin);
  expect(authorizationServer.registration_endpoint).toBe(`${origin}/oauth/register`);

  const registered = await server.call("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: [callback] }),
  });

  const { client_id: clientId } = z
    .object({ client_id: z.string() })
    .parse(await registered.json());

  const { verifier, challenge } = pkce();

  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callback,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "chatgpt-state",
    resource: `${origin}/mcp`,
  });

  const authorize = await server.call(`/oauth/authorize?${query.toString()}`);
  const page = authorize.headers.get("location") ?? "";

  expect(page).toStartWith("/sign-in/");
  expect(await (await server.call(page)).text()).toContain("ChatGPT");

  const allowed = await decide({
    server,
    id: page.slice("/sign-in/".length),
    fields: { decision: "allow", agent: agent.id },
  });

  const redirect = new URL(allowed.headers.get("location") ?? "");

  expect(redirect.searchParams.get("iss")).toBe(origin);
  expect(redirect.searchParams.get("state")).toBe("chatgpt-state");

  const exchangeResponse = await server.call("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code") ?? "",
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: callback,
    }).toString(),
  });

  const { access_token: token } = z
    .object({ access_token: z.string() })
    .parse(await exchangeResponse.json());

  const me = await (await server.call("/api/me", { token })).json();

  expect(me).toMatchObject({ identityId: agent.id });
});

test("points an MCP client without a token at where it signs in", async () => {
  const server = await createTestServer();
  const response = await server.call("/mcp", { method: "POST" });

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe(
    `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
  );
});
