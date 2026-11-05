import { expect, test } from "bun:test";

import { connectClient, createTestServer, openStream, type TestServer } from "../testing";

type AddEventOptions = { server: TestServer; agentId: string };

// An event as a Telegram message brings one, with a message id of its own.
function addEvent({ server, agentId }: AddEventOptions) {
  const messageId = crypto.randomUUID();

  server.services.events.add({
    agentId,
    event: { type: "message.received", channel: "telegram", messageId },
  });

  return messageId;
}

type SentEventOptions = { server: TestServer; agentId: string; messageId: string };

// The stream notes the last event it sent right after sending it, a moment after the client reads it.
async function untilNoted({ server, agentId, messageId }: SentEventOptions) {
  const sentEvent = server.services.events
    .listLatest(agentId)
    .find((event) => event.messageId === messageId);

  while (server.services.connections.findByAgent(agentId)?.startsAfter !== sentEvent?.id) {
    await Bun.sleep(1);
  }
}

test("ends a stream once its token is revoked", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const stream = await openStream(codex);

  server.services.tokens.revokeByAgent(codex.id);
  addEvent({ server, agentId: codex.id });

  await expect(stream.next()).rejects.toThrow("The stream ended");
});

test("hears what came between connecting and opening the stream", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const connectionId = await connectClient(codex);
  const messageId = addEvent({ server, agentId: codex.id });
  const stream = await openStream(codex, `?connection=${connectionId}`);

  expect(await stream.next()).toMatchObject({ messageId });

  stream.close();
});

test("resumes after the last event it sent when the same client comes back without a cursor", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const first = await openStream(codex, `?connection=${await connectClient(codex)}`);
  const heard = addEvent({ server, agentId: codex.id });

  expect(await first.next()).toMatchObject({ messageId: heard });

  await untilNoted({ server, agentId: codex.id, messageId: heard });
  first.close();

  // What comes while the server restarts, for one.
  const missed = addEvent({ server, agentId: codex.id });
  const second = await openStream(codex, `?connection=${await connectClient(codex)}`);

  expect(await second.next()).toMatchObject({ messageId: missed });

  second.close();
});

test("starts another client from now", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");

  addEvent({ server, agentId: codex.id });

  const stream = await openStream(codex, `?connection=${await connectClient(codex, "Pi")}`);
  const next = addEvent({ server, agentId: codex.id });

  expect(await stream.next()).toMatchObject({ messageId: next });

  stream.close();
});
