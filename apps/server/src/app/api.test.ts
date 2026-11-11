import { expect, test } from "bun:test";

import { z } from "zod";

import { createTestServer } from "./testing";

test("tells an account who it signs in as, the way the CLI reads Artil Cloud", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");

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

test("lists the team with each account's addresses and whether it listens", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");

  server.account("Claude");
  await server.connectAddress({ account: codex, word: "codex" });

  const team = await (await codex.call("/api/team")).json();

  expect(team).toEqual([
    expect.objectContaining({
      id: codex.id,
      kind: "agent",
      name: "Codex",
      addresses: [{ channel: "test", value: "@codex" }],
      listening: false,
    }),
    expect.objectContaining({ name: "Claude", addresses: [], listening: false }),
  ]);
});

test("lists the server's channels with the words and limits a client works with", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");

  const channels = await (await codex.call(`/api/agents/${codex.id}/channels`)).json();

  expect(channels).toEqual([
    {
      kind: "test",
      name: "Test",
      labels: {
        address: "word",
        contact: "name, @handle or -group",
        token: "word, which names the address @word",
      },
      limits: { recipients: 1, text: 100, files: 2, fileSize: 10 },
    },
    {
      kind: "url",
      name: "Message URL",
      labels: { address: "account id", contact: "account name or id" },
      limits: { recipients: 1, text: 2000, files: 10 },
    },
  ]);
});

test("sends on a channel by any kind the server has, and says where the rest are", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");

  await server.connectAddress({ account: codex, word: "codex" });

  async function send(channel: string) {
    const response = await codex.json(`/api/agents/${codex.id}/messages`, {
      channel,
      to: ["@ada"],
      text: "Hi",
    });

    return { status: response.status, body: await response.json() };
  }

  expect(await send("test")).toMatchObject({ status: 201, body: { channel: "test" } });
  expect(await send("email")).toMatchObject({
    status: 403,
    body: { error: { message: "Email is only in Artil Cloud (artil.ai)" } },
  });
  expect(await send("slack")).toMatchObject({
    status: 400,
    body: { error: { message: "This server has no slack channel" } },
  });
});

test("keeps an account's own routes to its own token", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const claude = server.account("Claude");

  expect((await codex.call(`/api/agents/${codex.id}`)).status).toBe(200);
  expect((await codex.call(`/api/agents/${claude.id}/messages`)).status).toBe(404);
  expect((await server.call(`/api/agents/${codex.id}`)).status).toBe(401);
});

test("signs a token out", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");

  expect((await codex.call("/api/me/token", { method: "DELETE" })).status).toBe(204);
  expect((await codex.call("/api/me")).status).toBe(401);
});

test("reads as having no webhooks, and says the rest is in Artil Cloud", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");

  expect(await (await codex.call(`/api/agents/${codex.id}/webhooks`)).json()).toEqual([]);

  const webhook = await codex.json(`/api/agents/${codex.id}/webhooks`, { url: "https://a.test" });

  expect(webhook.status).toBe(403);
  expect(await webhook.json()).toMatchObject({
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
    expect.arrayContaining(["/me", "/team", "/agents/{id}/messages", "/agents/{id}/events/stream"]),
  );
});
