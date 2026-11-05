import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { z } from "zod";

import { createReceivers } from "../channels/receivers";
import {
  createTestServer,
  listen,
  type TelegramUpdate,
  type TestAgent,
  type TestServer,
} from "../testing";

const token = "123456:bot-token";

type ConnectOptions = { server: TestServer; agent: TestAgent };

async function connectBot({ server, agent }: ConnectOptions) {
  server.telegram.bot(token, "CodexBot");

  const { value, credentials } = await server.telegramChannel.connect(token);

  server.services.addresses.connect({ agentId: agent.id, channel: "telegram", value, credentials });
}

type Update = {
  id: number;
  from: number;
  text?: string;
  username?: string;
  document?: NonNullable<TelegramUpdate["message"]>["document"];
};

function update({ id, from, text, username, document }: Update): TelegramUpdate {
  return {
    update_id: id,
    message: {
      message_id: id,
      from: { id: from, is_bot: false, first_name: "Ada", ...(username && { username }) },
      chat: { id: from, type: "private" },
      date: 1_760_000_000,
      ...(text !== undefined && { text }),
      ...(document && { document }),
    },
  };
}

// Asks the fake Telegram for updates once, the way the server does on a computer Telegram cannot
// reach, and waits until they are taken.
async function poll(server: TestServer) {
  const { promise, resolve } = Promise.withResolvers<void>();

  const receivers = createReceivers({
    channel: {
      ...server.telegramChannel,
      start: (options) =>
        server.telegramChannel.start({
          ...options,
          receive: async (events) => {
            await options.receive(events);
            resolve();
          },
        }),
    },
    addresses: server.services.addresses,
    receive: server.services.receive,
    log: () => {},
  });

  receivers.sync();
  await promise;
  receivers.stop();
}

test("wakes the agent with a Telegram message from a sender on its list", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  await connectBot({ server, agent: codex });
  server.services.access.addSender({ agentId: codex.id, channel: "telegram", sender: "@ada" });

  const stream = await listen(codex);

  server.telegram.queue(update({ id: 1, from: 42, text: "Deploy it", username: "Ada" }));
  await poll(server);

  const event = await stream.next();

  expect(event).toMatchObject({ type: "message.received", channel: "telegram" });

  const message = await (
    await codex.call(`/api/agents/${codex.id}/messages/${event.messageId}`)
  ).json();

  expect(message).toMatchObject({
    channel: "telegram",
    direction: "inbound",
    counterpart: "42",
    counterpartName: "Ada (@Ada)",
    text: "Deploy it",
    status: "received",
    admission: "listed",
  });

  stream.close();
});

test("keeps a stranger's message without waking the agent", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  await connectBot({ server, agent: codex });
  server.telegram.queue(update({ id: 1, from: 99, text: "Hello?" }));
  await poll(server);

  const listed = await codex.call(`/api/agents/${codex.id}/messages`);
  const [message] = z.array(z.looseObject({})).parse(await listed.json());

  expect(message).toMatchObject({ status: "refused", refusal: "outsider" });
  expect(server.services.events.listLatest(codex.id)).toEqual([]);
});

test("takes a message Telegram delivers twice once", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  await connectBot({ server, agent: codex });

  const message = update({ id: 7, from: 99, text: "Hi" });

  server.telegram.queue(message);
  server.telegram.queue(message);
  await poll(server);

  expect(server.services.messages.list({ agentId: codex.id, filter: {} })).toHaveLength(1);
});

test("answers a Telegram message in the chat it came from", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  await connectBot({ server, agent: codex });
  server.telegram.queue(update({ id: 1, from: 42, text: "Status?" }));
  await poll(server);

  const [received] = server.services.messages.list({ agentId: codex.id, filter: {} });

  const reply = await codex.json(`/api/agents/${codex.id}/messages`, {
    replyTo: received?.id ?? "",
    text: "All green",
  });

  expect(reply.status).toBe(201);
  expect(await reply.json()).toMatchObject({
    direction: "outbound",
    counterpart: "42",
    status: "sent",
  });
  expect(server.telegram.sent()).toEqual([
    { token, method: "sendMessage", body: { chat_id: 42, text: "All green" } },
  ]);
});

test("writes first only to someone who wrote to the bot", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  await connectBot({ server, agent: codex });

  const sent = await codex.json(`/api/agents/${codex.id}/messages`, {
    channel: "telegram",
    to: ["42"],
    text: "Hi",
  });

  expect(sent.status).toBe(400);
  expect(await sent.json()).toMatchObject({
    error: { message: "42 has to write to @codexbot before Codex can write to them" },
  });
});

test("keeps the files a Telegram message brings, behind a link", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  await connectBot({ server, agent: codex });
  server.telegram.file("doc-1", new TextEncoder().encode("report"));
  server.telegram.queue(
    update({
      id: 1,
      from: 42,
      document: { file_id: "doc-1", file_name: "report.txt", mime_type: "text/plain" },
    }),
  );
  await poll(server);

  const listed = await codex.call(`/api/agents/${codex.id}/messages`);

  const [message] = z
    .array(z.object({ attachments: z.array(z.object({ name: z.string(), url: z.url() })) }))
    .parse(await listed.json());

  const [attachment] = message?.attachments ?? [];
  const link = new URL(attachment?.url ?? "");

  expect(attachment?.name).toBe("report.txt");
  expect(await (await server.call(link.pathname + link.search)).text()).toBe("report");
});

test("takes Telegram's updates at its webhook when the server is public", async () => {
  const publicUrl = "https://mac.tailnet.ts.net";
  const server = await createTestServer({ publicUrl, password: "correct horse" });
  const codex = server.agent("Codex");

  await connectBot({ server, agent: codex });

  const secret = createHmac("sha256", "webhook-secret").update("CodexBot").digest("base64url");

  const posted = await server.call("/api/channels/telegram?bot=CodexBot", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(update({ id: 1, from: 42, text: "Hi" })),
  });

  expect(posted.status).toBe(204);
  expect(server.services.messages.list({ agentId: codex.id, filter: {} })).toHaveLength(1);

  const forgedUpdate = await server.call("/api/channels/telegram?bot=CodexBot", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "nope" },
    body: JSON.stringify(update({ id: 2, from: 42, text: "Hi" })),
  });

  expect(forgedUpdate.status).toBe(401);
});

test("takes the same message id at two bots as two messages, since each bot numbers its own", async () => {
  const publicUrl = "https://mac.tailnet.ts.net";
  const server = await createTestServer({ publicUrl, password: "correct horse" });

  for (const [botToken, username, name] of [
    ["1:first-token", "CodexBot", "Codex"],
    ["2:second-token", "ClaudeBot", "Claude"],
  ] as const) {
    server.telegram.bot(botToken, username);

    const { value, credentials } = await server.telegramChannel.connect(botToken);
    const agent = server.agent(name);

    server.services.addresses.connect({
      agentId: agent.id,
      channel: "telegram",
      value,
      credentials,
    });

    const posted = await server.call(`/api/channels/telegram?bot=${username}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": createHmac("sha256", "webhook-secret")
          .update(username)
          .digest("base64url"),
      },
      body: JSON.stringify(update({ id: 1, from: 42, text: `Hi ${name}` })),
    });

    expect(posted.status).toBe(204);
    expect(server.services.messages.list({ agentId: agent.id, filter: {} })).toMatchObject([
      { text: `Hi ${name}` },
    ]);
  }
});

test("lets a disconnected bot go to another agent, while its messages stay with the first", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const claude = server.agent("Claude");

  await connectBot({ server, agent: codex });
  server.telegram.queue(update({ id: 1, from: 42, text: "For Codex" }));
  await poll(server);

  server.services.addresses.disconnect({ agentId: codex.id, channel: "telegram" });

  const { value, credentials } = await server.telegramChannel.connect(token);

  server.services.addresses.connect({
    agentId: claude.id,
    channel: "telegram",
    value,
    credentials,
  });
  server.telegram.queue(update({ id: 2, from: 42, text: "For Claude" }));
  await poll(server);

  expect(server.services.messages.list({ agentId: codex.id, filter: {} })).toMatchObject([
    { text: "For Codex" },
  ]);
  expect(server.services.messages.list({ agentId: claude.id, filter: {} })).toMatchObject([
    { text: "For Claude" },
  ]);
  expect(server.services.agents.remove(claude.id)).toBe(true);
});

test("pages back to nothing from a message the agent does not have", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  await connectBot({ server, agent: codex });
  server.telegram.queue(update({ id: 1, from: 42, text: "Hi" }));
  await poll(server);

  const listed = await codex.call(`/api/agents/${codex.id}/messages?before=${crypto.randomUUID()}`);

  expect(await listed.json()).toEqual([]);
});

test("keeps a file by its description when the bucket fails, so the message still arrives", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  await connectBot({ server, agent: codex });
  server.memory.store.put = async () => {
    throw new Error("The bucket is down");
  };

  server.telegram.file("doc-1", new TextEncoder().encode("report"));
  server.telegram.queue(
    update({
      id: 1,
      from: 42,
      document: { file_id: "doc-1", file_name: "report.txt", mime_type: "text/plain" },
    }),
  );
  await poll(server);

  const [message] = server.services.messages.list({ agentId: codex.id, filter: {} });

  expect(message?.attachments).toEqual([
    { fileId: null, name: "report.txt", type: "text/plain", size: 6 },
  ]);
});
