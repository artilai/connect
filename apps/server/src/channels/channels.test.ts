import { expect, test } from "bun:test";

import type { Channel, ChannelEvent, OutboundMessage } from "@artil/channels/contract";

import { createTestServer, listen, type TestServer } from "../testing";
import { createReceivers } from "./receivers";

// A channel the server knows nothing of, the way someone writes one of their own.
function createEchoChannel() {
  const sent: OutboundMessage[] = [];
  const inbound: ChannelEvent[] = [];

  const channel = {
    kind: "echo",
    name: "Echo",
    recipients: "any name",
    credentials: "Any word",
    connect: async (credentials) => ({ value: `echo:${credentials}`, credentials }),
    start: async ({ receive }) => receive(inbound.splice(0)),
    send: async (message) => {
      sent.push(message);

      return { externalId: `out-${sent.length}` };
    },
  } satisfies Channel;

  return { channel, sent, inbound };
}

type ReceiveOnceOptions = { server: TestServer; channel: Channel };

async function receiveOnce({ server, channel }: ReceiveOnceOptions) {
  const receivers = createReceivers({
    channel,
    addresses: server.services.addresses,
    receive: server.services.receive,
    log: () => {},
  });

  receivers.sync();
  await Bun.sleep(0);
  receivers.stop();
}

test("takes a channel it knows nothing of, from its messages in to the agent's answer", async () => {
  const echo = createEchoChannel();
  const server = await createTestServer({ channels: [echo.channel] });
  const codex = server.agent("Codex");
  const stream = await listen(codex);

  const { value, credentials } = await echo.channel.connect("bot");

  server.services.addresses.connect({ agentId: codex.id, channel: "echo", value, credentials });
  server.services.access.addSender({ agentId: codex.id, channel: "echo", sender: "ada" });

  echo.inbound.push({
    type: "message.received",
    message: {
      externalId: "in-1",
      to: value,
      addressees: { to: [value], cc: [] },
      from: "ada",
      fromName: "Ada",
      fromHandle: null,
      fromVerified: true,
      subject: null,
      text: "Ping",
      files: [],
      spam: false,
      thread: null,
    },
  });

  await receiveOnce({ server, channel: echo.channel });

  const event = await stream.next();

  expect(event).toMatchObject({ type: "message.received", channel: "echo" });

  const message = await (
    await codex.call(`/api/agents/${codex.id}/messages/${event.messageId}`)
  ).json();

  expect(message).toMatchObject({ channel: "echo", text: "Ping", admission: "listed" });

  const answer = await codex.json(`/api/agents/${codex.id}/messages`, {
    replyTo: event.messageId,
    text: "Pong",
  });

  expect(answer.status).toBe(201);
  expect(echo.sent).toMatchObject([{ from: value, to: ["ada"], text: "Pong" }]);

  stream.close();
});
