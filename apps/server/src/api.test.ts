import { expect, test } from "bun:test";

import { z } from "zod";

import { createTestServer } from "./testing";

test("tells an agent who it signs in as, the way the CLI reads Artil Cloud", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  const me = await (await codex.call("/api/me")).json();

  expect(me).toEqual({
    kind: "identity",
    identityId: codex.id,
    signedInBy: expect.any(String),
    orgId: expect.any(String),
    workspace: { name: "test" },
    agent: { id: codex.id, name: "Codex" },
  });
});

test("lists the team with each agent's bot and whether it listens", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  server.agent("Claude");
  server.services.addresses.connect({
    agentId: codex.id,
    channel: "telegram",
    value: "@codexbot",
    credentials: "1:token",
  });

  const team = await (await codex.call("/api/team")).json();

  expect(team).toEqual([
    expect.objectContaining({
      id: codex.id,
      kind: "agent",
      name: "Codex",
      addresses: [{ channel: "telegram", value: "@codexbot" }],
      listening: false,
    }),
    expect.objectContaining({ name: "Claude", addresses: [], listening: false }),
  ]);
});

test("keeps an agent's own routes to its own token", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const claude = server.agent("Claude");

  expect((await codex.call(`/api/agents/${codex.id}`)).status).toBe(200);
  expect((await codex.call(`/api/agents/${claude.id}/messages`)).status).toBe(404);
  expect((await server.call(`/api/agents/${codex.id}`)).status).toBe(401);
});

test("signs a token out", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  expect((await codex.call("/api/me/token", { method: "DELETE" })).status).toBe(204);
  expect((await codex.call("/api/me")).status).toBe(401);
});

test("reads as having no secrets or webhooks, and says the rest is in Artil Cloud", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  expect(await (await codex.call(`/api/agents/${codex.id}/secrets`)).json()).toEqual([]);
  expect(await (await codex.call(`/api/agents/${codex.id}/webhooks`)).json()).toEqual([]);

  const secret = await codex.call(`/api/agents/${codex.id}/secrets`, { method: "PATCH" });

  expect(secret.status).toBe(403);
  expect(await secret.json()).toMatchObject({
    error: { code: "forbidden", message: expect.stringContaining("only in Artil Cloud") },
  });

  const email = await codex.json(`/api/agents/${codex.id}/messages`, {
    channel: "email",
    to: ["ada@example.com"],
    text: "Hi",
  });

  expect(email.status).toBe(403);
  expect((await codex.call(`/api/agents/${codex.id}/messages?channel=sms`)).status).toBe(403);
});

test("answers only at its own addresses", async () => {
  const server = await createTestServer();

  const response = await server.app.request("/api/health", { headers: { host: "evil.test" } });

  expect(response.status).toBe(403);
  expect((await server.call("/api/health")).status).toBe(200);
});

test("describes the API it answers", async () => {
  const server = await createTestServer();
  const described = await server.call("/api/openapi.json");
  const spec = z.object({ paths: z.record(z.string(), z.unknown()) }).parse(await described.json());

  expect(Object.keys(spec.paths)).toEqual(
    expect.arrayContaining([
      "/me",
      "/team",
      "/agents/{id}/messages",
      "/agents/{id}/url",
      "/agents/{id}/events/stream",
    ]),
  );
});
