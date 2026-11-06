import { expect, test } from "bun:test";

import { Channel, type StartOptions } from "@artil/channels/contract";

import { createTestServer } from "../../app/testing";
import { createReceivers } from "./receivers";

// A channel whose provider is down the first time it starts.
class FlakyChannel extends Channel<"test"> {
  readonly kind = "test";

  readonly name = "Flaky";

  readonly recipients = "anyone";

  starts = 0;

  override async start({ receive }: StartOptions) {
    this.starts += 1;

    if (this.starts === 1) throw new Error("The provider is down");

    await receive([
      {
        type: "message.received",
        message: {
          externalId: "1",
          to: "@codex",
          from: { address: "ada", name: null, handle: null, verified: true },
          text: "Hi",
          files: [],
        },
      },
    ]);
  }

  async send() {
    return { externalId: "1" };
  }
}

test("starts a channel again on an address after its start fails", async () => {
  const server = await createTestServer();
  const codex = server.agent("Codex");
  const channel = new FlakyChannel();
  const lines: string[] = [];
  const { promise: handedOver, resolve } = Promise.withResolvers<void>();

  await server.connectAddress({ agent: codex, word: "codex" });

  const receivers = createReceivers({
    channel,
    addresses: server.services.addresses,
    receive: async (options) => {
      await server.services.messages.receive(options);
      resolve();
    },
    log: (line) => lines.push(line),
    sleep: async () => {},
  });

  receivers.sync();
  await handedOver;
  receivers.stop();

  expect(channel.starts).toBe(2);
  expect(lines).toEqual(["@codex on test: The provider is down"]);
  expect(server.services.messages.list({ agentId: codex.id, filter: {} })).toMatchObject([
    { text: "Hi" },
  ]);
});
