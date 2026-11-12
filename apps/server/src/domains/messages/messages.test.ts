import { expect, setSystemTime, test } from "bun:test";

import { z } from "zod";

import { minute } from "@artil/utils/time";

import { createTestServer, listen, testWebhookHeader } from "../../app/testing";

const listedSchema = z.array(z.looseObject({ id: z.uuid() }));

test("wakes the agent with a message from a sender on its list", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });

  server.services.access.addSender({ accountId: codex.id, channel: "test", sender: "ada" });

  const stream = await listen(codex);

  server.testChannel.queue("codex", { id: "1", to: [address], from: "ada", text: "Deploy it" });
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
    author: null,
    authorName: null,
    text: "Deploy it",
    status: "received",
    admission: "listed",
  });

  stream.close();
});

test("lets a sender in by the handle the channel tells", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });

  server.services.access.addSender({ accountId: codex.id, channel: "test", sender: "@ada" });
  server.testChannel.queue("codex", { id: "1", to: [address], from: "42", username: "@ada" });
  await server.deliverQueued();

  expect(server.services.messages.list({ accountId: codex.id, filter: {} })).toMatchObject([
    { status: "received", admission: "listed" },
  ]);
});

test("keeps a stranger's message without waking the agent", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });

  server.testChannel.queue("codex", { id: "1", to: [address], from: "stranger", text: "Hello?" });
  await server.deliverQueued();

  const [message] = listedSchema.parse(
    await (await codex.call(`/api/agents/${codex.id}/messages`)).json(),
  );

  expect(message).toMatchObject({ status: "refused", refusal: "outsider" });
  expect(server.services.events.listLatest(codex.id)).toEqual([]);
});

test("says in the log how to let a stranger in, the first time they write", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });
  const fromAda = { to: [address], from: "42", username: "@ada" };

  server.testChannel.queue("codex", { id: "1", ...fromAda, text: "Hello?" });
  server.testChannel.queue("codex", { id: "2", ...fromAda, text: "Still there?" });
  await server.deliverQueued();

  expect(server.logs).toEqual([
    "@ada wrote to Codex on Test but is not on its list; let them in with: artil-connect account allow Codex 42 --channel test",
  ]);
  expect(server.services.messages.listKeptOut({ accountId: codex.id, channel: "test" })).toEqual([
    { sender: "42", name: null },
  ]);
});

test("says in the log how to let in someone in a group, or everyone in it, the first time the group writes", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });
  const inLaunch = { to: [address], group: { address: "-10042", name: "Launch" } };

  server.testChannel.queue("codex", { id: "1", ...inLaunch, from: "42", username: "@ada" });
  server.testChannel.queue("codex", { id: "2", ...inLaunch, from: "43", username: "@eve" });
  await server.deliverQueued();

  expect(server.logs).toEqual([
    "@ada wrote to Codex in Launch on Test but neither is on its list; let them in with: artil-connect account allow Codex 42 --channel test, or everyone in the group with: artil-connect account allow Codex --channel test -- -10042",
  ]);
  expect(server.services.messages.listKeptOut({ accountId: codex.id, channel: "test" })).toEqual([
    { sender: "-10042", name: "Launch" },
  ]);
});

test("wakes the agent with a stranger's message once anyone may", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });

  server.services.access.setAdmit({ accountId: codex.id, channel: "test", admit: "anyone" });
  server.testChannel.queue("codex", { id: "1", to: [address], from: "stranger", text: "Hello?" });
  await server.deliverQueued();

  const [message] = listedSchema.parse(
    await (await codex.call(`/api/agents/${codex.id}/messages`)).json(),
  );

  expect(message).toMatchObject({ status: "received", admission: "anyone" });
  expect(server.services.events.listLatest(codex.id)).toHaveLength(1);
});

test("takes a message its channel hands over twice once", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });
  const message = { id: "7", to: [address], from: "stranger", text: "Hi" };

  server.testChannel.queue("codex", message);
  server.testChannel.queue("codex", message);
  await server.deliverQueued();

  expect(server.services.messages.list({ accountId: codex.id, filter: {} })).toHaveLength(1);
});

test("takes a message at each of the server's addresses it went to", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const claude = server.account("Claude");
  const codexAddress = await server.connectAddress({ account: codex, word: "codex" });
  const claudeAddress = await server.connectAddress({ account: claude, word: "claude" });
  const to = [codexAddress, "@someone", claudeAddress];

  server.testChannel.queue("codex", { id: "1", to, from: "ada", text: "Hi both" });
  await server.deliverQueued();

  for (const account of [codex, claude]) {
    expect(server.services.messages.list({ accountId: account.id, filter: {} })).toMatchObject([
      { direction: "inbound", to, text: "Hi both" },
    ]);
  }
});

test("takes the same message id at two addresses as two messages", async () => {
  const server = await createTestServer();

  for (const name of ["Codex", "Claude"]) {
    const account = server.account(name);
    const word = name.toLowerCase();
    const address = await server.connectAddress({ account, word });

    server.testChannel.queue(word, { id: "1", to: [address], from: "ada", text: `Hi ${name}` });
  }

  await server.deliverQueued();

  for (const account of server.services.accounts.list()) {
    expect(server.services.messages.list({ accountId: account.id, filter: {} })).toMatchObject([
      { text: `Hi ${account.name}` },
    ]);
  }
});

test("answers a message the way it came", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });

  server.testChannel.queue("codex", { id: "1", to: [address], from: "ada", text: "Status?" });
  await server.deliverQueued();

  const [received] = server.services.messages.list({ accountId: codex.id, filter: {} });

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
    {
      message: { from: address, to: ["ada"], text: "All green", replyTo: "1" },
      token: "codex",
    },
  ]);
});

test("wakes the client thread that wrote what a message answers, or else the last one that wrote to its sender", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });

  server.services.access.setAdmit({ accountId: codex.id, channel: "test", admit: "anyone" });

  function sendFrom(thread: string) {
    return codex.json(`/api/agents/${codex.id}/messages`, {
      channel: "test",
      to: ["@ada"],
      text: "Hi",
      thread,
    });
  }

  await sendFrom("review");

  // The second message goes a minute later, so it is the last one.
  setSystemTime(new Date(Date.now() + minute));

  try {
    await sendFrom("deploy");
  } finally {
    setSystemTime();
  }

  const fromAda = { to: [address], from: "@ada" };

  server.testChannel.queue("codex", { id: "1", ...fromAda, text: "Approved", replyTo: "out-1" });
  server.testChannel.queue("codex", { id: "2", ...fromAda, text: "Anything else?" });
  server.testChannel.queue("codex", { id: "3", to: [address], from: "@eve", text: "Hello" });
  await server.deliverQueued();

  const events = await (await codex.call(`/api/agents/${codex.id}/events?after=0`)).json();

  expect(events).toMatchObject([
    { toThread: "review" },
    { toThread: "deploy" },
    { toThread: null },
  ]);
});

test("answers in the provider's thread a message is in, and wakes the client thread that last wrote in it", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });

  server.services.access.setAdmit({ accountId: codex.id, channel: "test", admit: "anyone" });

  const fromAda = { to: [address], from: "@ada" };

  server.testChannel.queue("codex", { id: "1", ...fromAda, text: "Review?", thread: "launch" });
  await server.deliverQueued();

  const [question] = server.services.messages.list({ accountId: codex.id, filter: {} });

  if (!question) throw new Error("Ada's question did not come");

  // The review thread answers in Ada's thread, and the deploy thread writes to her later, outside it.
  await codex.json(`/api/agents/${codex.id}/messages`, {
    replyTo: question.id,
    text: "On it",
    thread: "review",
  });

  setSystemTime(new Date(Date.now() + minute));

  try {
    await codex.json(`/api/agents/${codex.id}/messages`, {
      channel: "test",
      to: ["@ada"],
      text: "Deployed",
      thread: "deploy",
    });
  } finally {
    setSystemTime();
  }

  server.testChannel.queue("codex", { id: "2", ...fromAda, text: "Thanks", thread: "launch" });
  server.testChannel.queue("codex", { id: "3", ...fromAda, text: "Anything else?" });
  // A thread no client thread wrote in wakes the last one that wrote to her.
  server.testChannel.queue("codex", { id: "4", ...fromAda, text: "Ship it", thread: "release" });
  await server.deliverQueued();

  const events = await (await codex.call(`/api/agents/${codex.id}/events?after=0`)).json();

  expect(server.testChannel.sent[0]).toMatchObject({
    message: { replyTo: "1", thread: "launch" },
  });
  expect(events).toMatchObject([
    { toThread: null },
    { toThread: "review" },
    { toThread: "deploy" },
    { toThread: "deploy" },
  ]);
});

test("wakes no client thread whose message did not reach the sender", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });

  server.services.access.setAdmit({ accountId: codex.id, channel: "test", admit: "anyone" });
  server.testChannel.down = true;

  await codex.json(`/api/agents/${codex.id}/messages`, {
    channel: "test",
    to: ["@ada"],
    text: "Hi",
    thread: "review",
  });

  server.testChannel.queue("codex", { id: "1", to: [address], from: "@ada", text: "Hello" });
  await server.deliverQueued();

  const events = await (await codex.call(`/api/agents/${codex.id}/events?after=0`)).json();

  expect(events).toMatchObject([{ toThread: null }]);
});

test("keeps a message in a group as the group's, naming who wrote it, and answers in the group", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });
  const launch = { address: "-10042", name: "Launch" };

  server.services.access.addSender({ accountId: codex.id, channel: "test", sender: "-10042" });

  const stream = await listen(codex);

  server.testChannel.queue("codex", {
    id: "7",
    to: [address],
    from: "42",
    group: launch,
    text: "Hi",
  });
  await server.deliverQueued();

  const { messageId } = await stream.next();
  const received = await codex.call(`/api/agents/${codex.id}/messages/${messageId}`);

  expect(await received.json()).toMatchObject({
    direction: "inbound",
    counterpart: "-10042",
    counterpartName: "Launch",
    author: "42",
    authorName: null,
    status: "received",
    admission: "listed",
  });

  const reply = await codex.json(`/api/agents/${codex.id}/messages`, {
    replyTo: messageId,
    text: "On it",
  });

  expect(reply.status).toBe(201);
  expect(await reply.json()).toMatchObject({ counterpart: "-10042", author: null });
  expect(server.testChannel.sent).toMatchObject([
    { message: { to: ["-10042"], text: "On it", replyTo: "7" } },
  ]);

  stream.close();
});

test("wakes the agent from any group for someone on its list, and keeps the rest of the group out", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });
  const launch = { address: "-10042", name: "Launch" };

  server.services.access.addSender({ accountId: codex.id, channel: "test", sender: "ada" });
  server.testChannel.queue("codex", { id: "1", to: [address], from: "ada", group: launch });
  server.testChannel.queue("codex", { id: "2", to: [address], from: "eve", group: launch });
  await server.deliverQueued();

  const messages = server.services.messages.list({ accountId: codex.id, filter: {} });

  expect(messages.find(({ author }) => author === "ada")).toMatchObject({
    status: "received",
    admission: "listed",
  });
  expect(messages.find(({ author }) => author === "eve")).toMatchObject({
    status: "refused",
    refusal: "outsider",
  });
});

test("writes first only to someone the channel lets it", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");

  await server.connectAddress({ account: codex, word: "codex" });

  const sent = await server.services.messages
    .sendDraft({
      accountId: codex.id,
      accountName: "Codex",
      draft: { channel: "test", to: ["ada"], text: "Hi" },
      uploads: [],
    })
    .catch((cause: unknown) => cause);

  expect(sent).toMatchObject({
    message: "ada has to write to @codex before Codex can write to them",
  });
});

test("takes one of the server's accounts by name for its address on the channel", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const claude = server.account("Claude");

  await server.connectAddress({ account: codex, word: "codex" });

  function sendToClaude() {
    return codex.json(`/api/agents/${codex.id}/messages`, {
      channel: "test",
      to: ["Claude"],
      text: "Hi",
    });
  }

  const unconnected = await sendToClaude();

  expect(unconnected.status).toBe(400);
  expect(await unconnected.json()).toMatchObject({
    error: { message: "Claude has no Test word" },
  });

  await server.connectAddress({ account: claude, word: "claude" });

  expect((await sendToClaude()).status).toBe(201);
  expect(server.testChannel.sent).toMatchObject([{ message: { to: ["@claude"] } }]);
});

test("keeps the files a message brings, behind a link", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });
  const content = new TextEncoder().encode("report");

  server.testChannel.queue("codex", {
    id: "1",
    to: [address],
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

test("keeps a message, its files and the address's credentials encrypted at rest", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });
  const content = new TextEncoder().encode("report");

  server.testChannel.queue("codex", {
    id: "1",
    to: [address],
    from: "ada",
    text: "Deploy it",
    files: [{ name: "report.txt", type: "text/plain", size: content.byteLength, content }],
  });
  await server.deliverQueued();

  const sqlite = server.database.db.$client;

  const stored = sqlite
    .query<{ value: string }, []>(
      "select text as value from messages union all select name from files union all select credentials from addresses",
    )
    .all()
    .map(({ value }) => value);

  const [object] = server.memory.objects.values();

  expect(stored).toHaveLength(3);
  expect(stored.filter((value) => ["Deploy it", "report.txt", "codex"].includes(value))).toEqual(
    [],
  );
  expect(new TextDecoder().decode(object)).not.toContain("report");
  expect(server.services.messages.list({ accountId: codex.id, filter: {} })).toMatchObject([
    { text: "Deploy it", attachments: [{ name: "report.txt" }] },
  ]);
});

test("keeps a file by its description when the bucket fails, so the message still arrives", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });
  const content = new TextEncoder().encode("report");

  server.memory.store.put = async () => {
    throw new Error("The bucket is down");
  };

  server.testChannel.queue("codex", {
    id: "1",
    to: [address],
    from: "ada",
    files: [{ name: "report.txt", type: "text/plain", size: content.byteLength, content }],
  });
  await server.deliverQueued();

  const [message] = server.services.messages.list({ accountId: codex.id, filter: {} });

  expect(message?.attachments).toEqual([
    { fileId: null, name: "report.txt", type: "text/plain", size: 6, expiresAt: null },
  ]);
});

test("takes what a channel's provider posts to its webhook, signed", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });

  function post(secret: string) {
    return server.call("/api/channels/test", {
      method: "POST",
      headers: { "content-type": "application/json", [testWebhookHeader]: secret },
      body: JSON.stringify({ id: "1", to: [address], from: "ada", text: "Hi" }),
    });
  }

  expect((await post(server.services.channels.webhookSecretOf("test"))).status).toBe(204);
  expect(server.services.messages.list({ accountId: codex.id, filter: {} })).toHaveLength(1);
  expect((await post("forged")).status).toBe(401);
  expect((await server.call("/api/channels/url", { method: "POST" })).status).toBe(404);
});

test("lets a disconnected address go to another account, while its messages stay with the first", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const claude = server.account("Claude");
  const address = await server.connectAddress({ account: codex, word: "bot" });

  server.testChannel.queue("bot", { id: "1", to: [address], from: "ada", text: "For Codex" });
  await server.deliverQueued();
  await server.services.addresses.disconnect({ accountId: codex.id, kind: "test" });

  await server.connectAddress({ account: claude, word: "bot" });
  server.testChannel.queue("bot", { id: "2", to: [address], from: "ada", text: "For Claude" });
  await server.deliverQueued();

  expect(server.services.messages.list({ accountId: codex.id, filter: {} })).toMatchObject([
    { text: "For Codex" },
  ]);
  expect(server.services.messages.list({ accountId: claude.id, filter: {} })).toMatchObject([
    { text: "For Claude" },
  ]);
  expect(await server.services.accounts.remove(claude.id)).toBe(true);
});

test("pages back to nothing from a message the account does not have", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const address = await server.connectAddress({ account: codex, word: "codex" });

  server.testChannel.queue("codex", { id: "1", to: [address], from: "ada", text: "Hi" });
  await server.deliverQueued();

  const listed = await codex.call(`/api/agents/${codex.id}/messages?before=${crypto.randomUUID()}`);

  expect(await listed.json()).toEqual([]);
});
