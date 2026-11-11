import { expect, test } from "bun:test";

import { z } from "zod";

import { day } from "@artil/utils/time";

import { createTestServer, listen } from "../../app/testing";

const attachmentsSchema = z.object({
  attachments: z.array(z.object({ name: z.string(), url: z.url() })),
});

test("hands a message at an agent's Message URL to the client that listens to it", async () => {
  const server = await createTestServer();
  const claude = server.agent("Claude");
  const codex = server.agent("Codex");
  const stream = await listen(codex);

  const sent = await claude.json(`/api/agents/${codex.id}/url`, {
    text: "Review the PR",
    thread: "claude-thread",
    client: "Claude Code",
  });

  expect(sent.status).toBe(201);

  expect(await stream.next()).toMatchObject({
    type: "message.received",
    channel: "url",
    text: "Review the PR",
    sender: { id: claude.id, kind: "agent", name: "Claude", email: null },
    thread: "claude-thread",
    toThread: null,
    client: "Claude Code",
    attachments: [],
  });

  stream.close();
});

test("keeps a message at the Message URL among the messages of both agents", async () => {
  const server = await createTestServer();
  const claude = server.agent("Claude");
  const codex = server.agent("Codex");
  const stream = await listen(codex);

  await claude.json(`/api/agents/${codex.id}/url`, { text: "Review the PR" });

  const { messageId } = await stream.next();
  const received = await codex.call(`/api/agents/${codex.id}/messages/${messageId}`);

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

  expect(await (await claude.call(`/api/agents/${claude.id}/messages`)).json()).toMatchObject([
    {
      channel: "url",
      direction: "outbound",
      counterpart: codex.id,
      to: [codex.id],
      text: "Review the PR",
      status: "sent",
    },
  ]);

  stream.close();
});

test("answers a message at the Message URL in the thread it came from", async () => {
  const server = await createTestServer();
  const claude = server.agent("Claude");
  const codex = server.agent("Codex");
  const claudeStream = await listen(claude);
  const codexStream = await listen(codex);

  await claude.json(`/api/agents/${codex.id}/url`, { text: "Review the PR", thread: "pr-42" });

  const { messageId } = await codexStream.next();

  const reply = await codex.json(`/api/agents/${codex.id}/messages`, {
    replyTo: messageId,
    text: "Approved",
  });

  expect(reply.status).toBe(201);
  expect(await reply.json()).toMatchObject({
    channel: "url",
    direction: "outbound",
    counterpart: claude.id,
    text: "Approved",
    status: "sent",
  });
  expect(await claudeStream.next()).toMatchObject({
    text: "Approved",
    sender: { id: codex.id },
    toThread: "pr-42",
  });

  claudeStream.close();
  codexStream.close();
});

test("writes again to whom it wrote at the Message URL by answering what it sent", async () => {
  const server = await createTestServer();
  const claude = server.agent("Claude");
  const codex = server.agent("Codex");
  const stream = await listen(codex);

  await claude.json(`/api/agents/${codex.id}/url`, { text: "Review the PR" });
  await stream.next();

  const [sent] = z
    .array(z.object({ id: z.uuid() }))
    .parse(await (await claude.call(`/api/agents/${claude.id}/messages`)).json());

  const followUp = await claude.json(`/api/agents/${claude.id}/messages`, {
    replyTo: sent?.id ?? "",
    text: "Any news?",
  });

  expect(followUp.status).toBe(201);
  expect(await stream.next()).toMatchObject({ text: "Any news?", sender: { id: claude.id } });

  stream.close();
});

test("refuses a message when nobody listens to the agent", async () => {
  const server = await createTestServer();
  const claude = server.agent("Claude");
  const codex = server.agent("Codex");

  const sent = await claude.json(`/api/agents/${codex.id}/url`, { text: "Hi" });

  expect(sent.status).toBe(409);
  expect(await sent.json()).toMatchObject({
    error: { message: "No one is listening to Codex; write to it at another of its addresses" },
  });
});

test("takes a message at the short Message URL too", async () => {
  const server = await createTestServer();
  const claude = server.agent("Claude");
  const codex = server.agent("Codex");
  const stream = await listen(codex);

  const sent = await claude.json(`/a/${codex.id}`, { text: "Hi" });

  expect(sent.status).toBe(201);
  expect(await stream.next()).toMatchObject({ text: "Hi" });

  stream.close();
});

test("ends a stream once another client connects, and refuses it after", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const first = await listen(codex, "Pi");
  const second = await listen(codex, "Claude Code");

  const reopenedStream = await codex.call(
    `/api/agents/${codex.id}/events/stream?connection=${first.connectionId}`,
  );

  expect(reopenedStream.status).toBe(409);
  expect(second.response.status).toBe(200);

  first.close();
  second.close();
});

test("brings a relayed message's files, which both agents keep as they keep any message's", async () => {
  const server = await createTestServer();
  const claude = server.agent("Claude");
  const codex = server.agent("Codex");
  const stream = await listen(codex);

  const form = new FormData();

  form.set("draft", JSON.stringify({ text: "The log" }));
  form.append("file", new File(["line one"], "run.log", { type: "text/plain" }));

  const sent = await claude.call(`/api/agents/${codex.id}/url`, { method: "POST", body: form });

  expect(sent.status).toBe(201);

  const event = await stream.next();
  const [attachment] = event.attachments ?? [];

  expect(attachment).toMatchObject({
    name: "run.log",
    type: expect.stringMatching(/^text\/plain/v),
    size: 8,
  });

  const download = await server.call(
    new URL(attachment?.url ?? "").pathname + new URL(attachment?.url ?? "").search,
  );

  expect(download.status).toBe(200);
  expect(await download.text()).toBe("line one");

  await server.services.files.removeExpired(new Date(Date.now() + 2 * day));

  const received = attachmentsSchema.parse(
    await (await codex.call(`/api/agents/${codex.id}/messages/${event.messageId}`)).json(),
  );

  const [sentMessage] = z
    .array(attachmentsSchema)
    .parse(await (await claude.call(`/api/agents/${claude.id}/messages`)).json());

  expect(sentMessage?.attachments).toHaveLength(1);

  for (const { url } of [...received.attachments, ...(sentMessage?.attachments ?? [])]) {
    const link = new URL(url);

    expect(await (await server.call(link.pathname + link.search)).text()).toBe("line one");
  }

  stream.close();
});

test("says files are off on a server without a bucket", async () => {
  const server = await createTestServer({ files: false });
  const claude = server.agent("Claude");
  const codex = server.agent("Codex");
  const stream = await listen(codex);

  const sent = await claude.json(`/api/agents/${codex.id}/url`, {
    text: "Notes",
    attachments: [{ name: "notes.txt", type: "text/plain", text: "Hi" }],
  });

  expect(sent.status).toBe(503);
  expect(await sent.json()).toMatchObject({
    error: { message: expect.stringContaining("Files are off") },
  });

  stream.close();
});

test("lets an agent write to its own Message URL only from one thread to another", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const stream = await listen(codex);

  expect((await codex.json(`/api/agents/${codex.id}/url`, { text: "Hi" })).status).toBe(400);
  expect(
    (await codex.json(`/api/agents/${codex.id}/url`, { text: "Hi", thread: "a" })).status,
  ).toBe(201);

  stream.close();
});
