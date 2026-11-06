import { expect, test } from "bun:test";

import { z } from "zod";

import { createTestServer, listen, testWebhookHeader } from "../../app/testing";

const listedSchema = z.array(z.looseObject({ id: z.uuid() }));

test("wakes the agent with a message from a sender on its list", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const address = await server.connectAddress({ agent: codex, word: "codex" });

  server.services.access.addSender({ agentId: codex.id, channel: "test", sender: "ada" });

  const stream = await listen(codex);

  server.testChannel.queue("codex", { id: "1", to: address, from: "ada", text: "Deploy it" });
  await server.deliverQueued();

  const event = await stream.next();

  expect(event).toMatchObject({ type: "message.received", channel: "test" });

  const message = await (
    await codex.call(`/api/agents/${codex.id}/messages/${event.messageId}`)
  ).json();

  expect(message).toMatchObject({
    channel: "test",
    direction: "inbound",
    counterpart: "ada",
    text: "Deploy it",
    status: "received",
    admission: "listed",
  });

  stream.close();
});

test("lets a sender in by the handle the channel tells", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const address = await server.connectAddress({ agent: codex, word: "codex" });

  server.services.access.addSender({ agentId: codex.id, channel: "test", sender: "@ada" });
  server.testChannel.queue("codex", { id: "1", to: address, from: "42", fromHandle: "@ada" });
  await server.deliverQueued();

  expect(server.services.messages.list({ agentId: codex.id, filter: {} })).toMatchObject([
    { status: "received", admission: "listed" },
  ]);
});

test("keeps a stranger's message without waking the agent", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const address = await server.connectAddress({ agent: codex, word: "codex" });

  server.testChannel.queue("codex", { id: "1", to: address, from: "stranger", text: "Hello?" });
  await server.deliverQueued();

  const [message] = listedSchema.parse(
    await (await codex.call(`/api/agents/${codex.id}/messages`)).json(),
  );

  expect(message).toMatchObject({ status: "refused", refusal: "outsider" });
  expect(server.services.events.listLatest(codex.id)).toEqual([]);
});

test("takes a message its channel hands over twice once", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const address = await server.connectAddress({ agent: codex, word: "codex" });
  const message = { id: "7", to: address, from: "stranger", text: "Hi" };

  server.testChannel.queue("codex", message);
  server.testChannel.queue("codex", message);
  await server.deliverQueued();

  expect(server.services.messages.list({ agentId: codex.id, filter: {} })).toHaveLength(1);
});

test("takes the same message id at two addresses as two messages", async () => {
  const server = await createTestServer();

  for (const name of ["Codex", "Claude"]) {
    const agent = server.agent(name);
    const word = name.toLowerCase();
    const address = await server.connectAddress({ agent, word });

    server.testChannel.queue(word, { id: "1", to: address, from: "ada", text: `Hi ${name}` });
  }

  await server.deliverQueued();

  for (const agent of server.services.agents.list()) {
    expect(server.services.messages.list({ agentId: agent.id, filter: {} })).toMatchObject([
      { text: `Hi ${agent.name}` },
    ]);
  }
});

test("answers a message the way it came", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const address = await server.connectAddress({ agent: codex, word: "codex" });

  server.testChannel.queue("codex", { id: "1", to: address, from: "ada", text: "Status?" });
  await server.deliverQueued();

  const [received] = server.services.messages.list({ agentId: codex.id, filter: {} });

  const reply = await codex.json(`/api/agents/${codex.id}/messages`, {
    replyTo: received?.id ?? "",
    text: "All green",
  });

  expect(reply.status).toBe(201);
  expect(await reply.json()).toMatchObject({
    channel: "test",
    direction: "outbound",
    counterpart: "ada",
    status: "sent",
  });
  expect(server.testChannel.sent).toMatchObject([
    { from: address, credentials: "codex", to: ["ada"], text: "All green" },
  ]);
});

test("writes first only to someone the channel lets it", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  await server.connectAddress({ agent: codex, word: "codex" });

  const sent = await server.services.messages
    .send({
      agentId: codex.id,
      agentName: "Codex",
      draft: { channel: "test", to: ["ada"], text: "Hi" },
      uploads: [],
    })
    .catch((cause: unknown) => cause);

  expect(sent).toMatchObject({
    message: "ada has to write to @codex before Codex can write to them",
  });
});

test("keeps the files a message brings, behind a link", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const address = await server.connectAddress({ agent: codex, word: "codex" });
  const content = new TextEncoder().encode("report");

  server.testChannel.queue("codex", {
    id: "1",
    to: address,
    from: "ada",
    files: [{ name: "report.txt", type: "text/plain", size: content.byteLength, content }],
  });
  await server.deliverQueued();

  const [message] = z
    .array(z.object({ attachments: z.array(z.object({ name: z.string(), url: z.url() })) }))
    .parse(await (await codex.call(`/api/agents/${codex.id}/messages`)).json());

  const [attachment] = message?.attachments ?? [];
  const link = new URL(attachment?.url ?? "");

  expect(attachment?.name).toBe("report.txt");
  expect(await (await server.call(link.pathname + link.search)).text()).toBe("report");
});

test("keeps a file by its description when the bucket fails, so the message still arrives", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const address = await server.connectAddress({ agent: codex, word: "codex" });
  const content = new TextEncoder().encode("report");

  server.memory.store.put = async () => {
    throw new Error("The bucket is down");
  };

  server.testChannel.queue("codex", {
    id: "1",
    to: address,
    from: "ada",
    files: [{ name: "report.txt", type: "text/plain", size: content.byteLength, content }],
  });
  await server.deliverQueued();

  const [message] = server.services.messages.list({ agentId: codex.id, filter: {} });

  expect(message?.attachments).toEqual([
    { fileId: null, name: "report.txt", type: "text/plain", size: 6 },
  ]);
});

test("takes what a channel's provider posts to its webhook, signed", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const address = await server.connectAddress({ agent: codex, word: "codex" });

  function post(secret: string) {
    return server.call("/api/channels/test", {
      method: "POST",
      headers: { "content-type": "application/json", [testWebhookHeader]: secret },
      body: JSON.stringify({ id: "1", to: address, from: "ada", text: "Hi" }),
    });
  }

  expect((await post("webhook-secret")).status).toBe(204);
  expect(server.services.messages.list({ agentId: codex.id, filter: {} })).toHaveLength(1);
  expect((await post("forged")).status).toBe(401);
  expect((await server.call("/api/channels/url", { method: "POST" })).status).toBe(404);
});

test("lets a disconnected address go to another agent, while its messages stay with the first", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const claude = server.agent("Claude");
  const address = await server.connectAddress({ agent: codex, word: "bot" });

  server.testChannel.queue("bot", { id: "1", to: address, from: "ada", text: "For Codex" });
  await server.deliverQueued();
  await server.services.addresses.disconnect({ agentId: codex.id, kind: "test" });

  await server.connectAddress({ agent: claude, word: "bot" });
  server.testChannel.queue("bot", { id: "2", to: address, from: "ada", text: "For Claude" });
  await server.deliverQueued();

  expect(server.services.messages.list({ agentId: codex.id, filter: {} })).toMatchObject([
    { text: "For Codex" },
  ]);
  expect(server.services.messages.list({ agentId: claude.id, filter: {} })).toMatchObject([
    { text: "For Claude" },
  ]);
  expect(await server.services.agents.remove(claude.id)).toBe(true);
});

test("pages back to nothing from a message the agent does not have", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const address = await server.connectAddress({ agent: codex, word: "codex" });

  server.testChannel.queue("codex", { id: "1", to: address, from: "ada", text: "Hi" });
  await server.deliverQueued();

  const listed = await codex.call(`/api/agents/${codex.id}/messages?before=${crypto.randomUUID()}`);

  expect(await listed.json()).toEqual([]);
});
