import { expect, test } from "bun:test";

import { z } from "zod";

import { day } from "@artil/utils/time";

import { createTestServer, listen } from "../../app/testing";

const attachmentsSchema = z.object({
  attachments: z.array(z.object({ name: z.string(), url: z.url() })),
});

test("hands a message at an account's Message URL to the client that listens to it", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
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

test("keeps a message at the Message URL among the messages of both accounts", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
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
  const claude = server.account("Claude");
  const codex = server.account("Codex");
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

test("writes again to the thread it wrote to at the Message URL by answering what it sent", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
  const stream = await listen(codex);

  await claude.json(`/api/agents/${codex.id}/url`, { text: "Review the PR", toThread: "pr-42" });
  await stream.next();

  const [sent] = z
    .array(z.object({ id: z.uuid() }))
    .parse(await (await claude.call(`/api/agents/${claude.id}/messages`)).json());

  const followUp = await claude.json(`/api/agents/${claude.id}/messages`, {
    replyTo: sent?.id ?? "",
    text: "Any news?",
  });

  expect(followUp.status).toBe(201);
  expect(await stream.next()).toMatchObject({
    text: "Any news?",
    sender: { id: claude.id },
    toThread: "pr-42",
  });

  stream.close();
});

test("marks the sender's copy failed when the message does not reach the account", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");

  // An account removed while the message was on its way.
  await expect(
    server.services.messages.receiveRelay({
      from: { id: claude.id, name: "Claude" },
      to: "removed",
      text: "Review the PR",
      files: [],
      thread: null,
      toThread: null,
      client: null,
    }),
  ).rejects.toThrow();

  expect(server.services.messages.list({ accountId: claude.id, filter: {} })).toMatchObject([
    { channel: "url", direction: "outbound", status: "failed", error: expect.any(String) },
  ]);
});

test("refuses a message when nobody listens to the account", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");

  const sent = await claude.json(`/api/agents/${codex.id}/url`, { text: "Hi" });

  expect(sent.status).toBe(409);
  expect(await sent.json()).toMatchObject({
    error: {
      message:
        "No one is listening to Codex: start its client, and turn on new messages there with: artil listen on",
    },
  });
});

test("refuses an account its list leaves out, once only the list wakes it", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
  const stream = await listen(codex);

  server.services.access.setAdmit({ accountId: codex.id, channel: "url", admit: "list" });

  const refused = await claude.json(`/api/agents/${codex.id}/url`, { text: "Hi" });

  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({
    error: { message: "Codex does not take messages from you at its Message URL" },
  });

  server.services.access.addSender({ accountId: codex.id, channel: "url", sender: claude.id });

  expect((await claude.json(`/api/agents/${codex.id}/url`, { text: "Hi" })).status).toBe(201);

  stream.close();
});

test("lets in an account a person put on its list by name", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
  const stream = await listen(codex);
  const url = server.services.channels.get("url");
  const sender = url.readSender("claude");

  if (!sender) throw new Error("The Message URL did not read Claude by name");

  server.services.access.setAdmit({ accountId: codex.id, channel: "url", admit: "list" });
  server.services.access.addSender({ accountId: codex.id, channel: "url", sender });

  expect((await claude.json(`/api/agents/${codex.id}/url`, { text: "Hi" })).status).toBe(201);
  expect(url.showSender?.(sender)).toBe("Claude");
  expect(url.readSender("nobody")).toBeNull();

  stream.close();
});

test("takes a message at the short Message URL too", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
  const stream = await listen(codex);

  const sent = await claude.json(`/a/${codex.id}`, { text: "Hi" });

  expect(sent.status).toBe(201);
  expect(await stream.next()).toMatchObject({ text: "Hi" });

  stream.close();
});

test("ends a stream once another client connects, and refuses it after", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
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

test("brings a relayed message's files, which both accounts keep as they keep any message's", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
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

  const link = new URL(attachment?.url ?? "");
  const download = await server.call(link.pathname + link.search);

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
    const fileLink = new URL(url);

    expect(await (await server.call(fileLink.pathname + fileLink.search)).text()).toBe("line one");
  }

  stream.close();
});

test("says files are off on a server without a bucket", async () => {
  const server = await createTestServer({ files: false });
  const claude = server.account("Claude");
  const codex = server.account("Codex");
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

test("lets an account write to its own Message URL only from one thread to another", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const stream = await listen(codex);

  expect((await codex.json(`/api/agents/${codex.id}/url`, { text: "Hi" })).status).toBe(400);
  expect(
    (await codex.json(`/api/agents/${codex.id}/url`, { text: "Hi", thread: "a" })).status,
  ).toBe(201);

  stream.close();
});
