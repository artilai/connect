import { expect, test } from "bun:test";

import { z } from "zod";

import { createTestServer, listen } from "../../app/testing";

const attachmentsSchema = z.object({
  attachments: z.array(z.object({ name: z.string(), url: z.url() })),
});

test("sends to another account at its Message URL, which wakes it and keeps the message", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
  const stream = await listen(codex);

  const sent = await claude.json(`/api/agents/${claude.id}/messages`, {
    channel: "url",
    to: ["codex"],
    text: "Review the PR",
  });

  expect(sent.status).toBe(201);
  expect(await sent.json()).toMatchObject({
    channel: "url",
    direction: "outbound",
    counterpart: codex.id,
    to: [codex.id],
    text: "Review the PR",
    status: "sent",
  });

  const event = await stream.next();

  expect(event).toMatchObject({ type: "message.received", channel: "url", toThread: null });

  const received = await codex.call(`/api/agents/${codex.id}/messages/${event.messageId}`);

  expect(await received.json()).toMatchObject({
    channel: "url",
    direction: "inbound",
    counterpart: claude.id,
    counterpartName: "Claude",
    to: [codex.id],
    text: "Review the PR",
    status: "received",
    admission: "team",
  });

  stream.close();
});

test("answers a message at the Message URL in the thread of the client it came from", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
  const claudeStream = await listen(claude);
  const codexStream = await listen(codex);

  await claude.json(`/api/agents/${claude.id}/messages`, {
    channel: "url",
    to: [codex.id],
    text: "Review the PR",
    thread: "pr-42",
  });

  const { messageId } = await codexStream.next();

  const reply = await codex.json(`/api/agents/${codex.id}/messages`, {
    replyTo: messageId,
    text: "Approved",
  });

  expect(reply.status).toBe(201);

  const answer = await claudeStream.next();

  expect(answer).toMatchObject({ channel: "url", toThread: "pr-42" });
  expect(
    await (await claude.call(`/api/agents/${claude.id}/messages/${answer.messageId}`)).json(),
  ).toMatchObject({ counterpart: codex.id, counterpartName: "Codex", text: "Approved" });

  claudeStream.close();
  codexStream.close();
});

test("takes a message posted to an account's Message URL", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
  const stream = await listen(codex);

  const sent = await claude.json(`/a/${codex.id}`, { text: "Hi" });

  expect(sent.status).toBe(201);
  expect(await sent.json()).toMatchObject({
    channel: "url",
    direction: "outbound",
    to: [codex.id],
    text: "Hi",
  });
  expect(await stream.next()).toMatchObject({ type: "message.received", channel: "url" });

  stream.close();
});

test("refuses an account the list leaves out, once only the list wakes the account", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");

  server.services.access.setAdmit({ accountId: codex.id, channel: "url", admit: "list" });

  const refused = await claude.json(`/a/${codex.id}`, { text: "Hi" });

  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({
    error: { message: "Codex does not take Message URL messages from you" },
  });

  server.services.access.addSender({ accountId: codex.id, channel: "url", sender: claude.id });

  expect((await claude.json(`/a/${codex.id}`, { text: "Hi" })).status).toBe(201);
});

test("lets an account write to itself at its Message URL only from one thread to another", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const stream = await listen(codex);

  const unthreaded = await codex.json(`/a/${codex.id}`, { text: "Hi" });

  expect(unthreaded.status).toBe(400);
  expect(await unthreaded.json()).toMatchObject({
    error: {
      message:
        "An agent writes to itself on Message URL only from one thread of its client to another",
    },
  });

  await codex.json(`/a/${codex.id}`, { text: "Take the review", thread: "planning" });

  const handedOver = await stream.next();

  expect(handedOver).toMatchObject({ channel: "url", toThread: null });

  // The thread that took it answers, which wakes the one that wrote it.
  await codex.json(`/api/agents/${codex.id}/messages`, {
    replyTo: handedOver.messageId,
    text: "On it",
    thread: "review",
  });

  expect(await stream.next()).toMatchObject({ channel: "url", toThread: "planning" });

  stream.close();
});

test("brings a message's files, which both accounts keep", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
  const stream = await listen(codex);
  const form = new FormData();

  form.set("draft", JSON.stringify({ text: "The log" }));
  form.append("file", new File(["line one"], "run.log", { type: "text/plain" }));

  const sent = await claude.call(`/a/${codex.id}`, { method: "POST", body: form });

  expect(sent.status).toBe(201);

  const kept = attachmentsSchema.parse(await sent.json());
  const { messageId } = await stream.next();

  const received = attachmentsSchema.parse(
    await (await codex.call(`/api/agents/${codex.id}/messages/${messageId}`)).json(),
  );

  expect([...kept.attachments, ...received.attachments]).toMatchObject([
    { name: "run.log" },
    { name: "run.log" },
  ]);

  for (const { url } of [...kept.attachments, ...received.attachments]) {
    const link = new URL(url);

    expect(await (await server.call(link.pathname + link.search)).text()).toBe("line one");
  }

  stream.close();
});

test("says files are off on a server without a bucket", async () => {
  const server = await createTestServer({ files: false });
  const claude = server.account("Claude");
  const codex = server.account("Codex");

  const sent = await claude.json(`/a/${codex.id}`, {
    text: "Notes",
    attachments: [{ name: "notes.txt", type: "text/plain", text: "Hi" }],
  });

  expect(sent.status).toBe(503);
  expect(await sent.json()).toMatchObject({
    error: { message: expect.stringContaining("Files are off") },
  });
});
