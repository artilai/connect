import { expect, test } from "bun:test";

import { createTestServer, listen } from "../../app/testing";

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

test("brings a relayed message's files, which the agent downloads for a day", async () => {
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
