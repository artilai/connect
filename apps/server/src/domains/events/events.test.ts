import { expect, test } from "bun:test";

import { connectClient, createTestServer, openStream, type TestServer } from "../../app/testing";

type AddEventOptions = { server: TestServer; accountId: string };

// An event as a channel's message brings one, with a message id of its own.
function addEvent({ server, accountId }: AddEventOptions) {
  const messageId = crypto.randomUUID();

  server.services.events.add({
    accountId,
    event: { type: "message.received", channel: "test", messageId },
  });

  return messageId;
}

type SentEventOptions = { server: TestServer; accountId: string; messageId: string };

// The stream notes the last event it sent right after sending it, a moment after the client reads it.
async function untilNoted({ server, accountId, messageId }: SentEventOptions) {
  const sentEvent = server.services.events
    .listLatest(accountId)
    .find((event) => event.messageId === messageId);

  while (server.services.connections.findByAccount(accountId)?.startsAfter !== sentEvent?.id) {
    await Bun.sleep(1);
  }
}

test("ends a stream once its token is revoked", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const stream = await openStream(codex);

  server.services.tokens.revokeByAccount(codex.id);
  addEvent({ server, accountId: codex.id });

  await expect(stream.next()).rejects.toThrow("The stream ended");
});

test("hears what came between connecting and opening the stream", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const connectionId = await connectClient(codex);
  const messageId = addEvent({ server, accountId: codex.id });
  const stream = await openStream(codex, `?connection=${connectionId}`);

  expect(await stream.next()).toMatchObject({ messageId });

  stream.close();
});

test("resumes after the last event it sent when the same client comes back without a cursor", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const first = await openStream(codex, `?connection=${await connectClient(codex)}`);
  const heard = addEvent({ server, accountId: codex.id });

  expect(await first.next()).toMatchObject({ messageId: heard });

  await untilNoted({ server, accountId: codex.id, messageId: heard });
  first.close();

  // What comes while the server restarts, for one.
  const missed = addEvent({ server, accountId: codex.id });
  const second = await openStream(codex, `?connection=${await connectClient(codex)}`);

  expect(await second.next()).toMatchObject({ messageId: missed });

  second.close();
});

test("starts another client from now", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");

  addEvent({ server, accountId: codex.id });

  const stream = await openStream(codex, `?connection=${await connectClient(codex, "Pi")}`);
  const next = addEvent({ server, accountId: codex.id });

  expect(await stream.next()).toMatchObject({ messageId: next });

  stream.close();
});
