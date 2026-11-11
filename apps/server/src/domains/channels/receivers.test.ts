import { expect, setSystemTime, test } from "bun:test";

import { Channel, type StartOptions } from "@artil/channels/contract";
import { minute, second } from "@artil/utils/time";

import { createTestServer } from "../../app/testing";
import { createReceivers } from "./receivers";

// A channel whose provider is down the first time it starts.
class FlakyChannel extends Channel {
  readonly kind = "test";

  readonly name = "Flaky";

  readonly labels = { address: "address", contact: "name" };

  starts = 0;

  override async start({ receive }: StartOptions) {
    this.starts += 1;

    if (this.starts === 1) throw new Error("The provider is down");

    await receive([
      {
        type: "message.received",
        message: {
          id: "1",
          to: ["@codex"],
          from: { address: "ada", name: null, username: null, verified: true },
          text: "Hi",
          files: [],
        },
      },
    ]);
  }

  async send() {
    return { id: "1" };
  }
}

test("starts a channel again on an address after its start fails", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const channel = new FlakyChannel();
  const lines: string[] = [];
  const { promise: handedOver, resolve } = Promise.withResolvers<void>();

  await server.connectAddress({ account: codex, word: "codex" });

  const receivers = createReceivers({
    channel,
    webhookSecret: "secret",
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
  expect(server.services.messages.list({ accountId: codex.id, filter: {} })).toMatchObject([
    { text: "Hi" },
  ]);
});

// A channel that fails three times, the third after it ran for a while, and then stays up.
class FailingChannel extends Channel {
  readonly kind = "test";

  readonly name = "Failing";

  readonly labels = { address: "address", contact: "name" };

  readonly #started = Promise.withResolvers<void>();

  readonly up = this.#started.promise;

  starts = 0;

  override async start() {
    this.starts += 1;

    if (this.starts === 3) setSystemTime(new Date(Date.now() + 2 * minute));

    if (this.starts <= 3) throw new Error("The provider is down");

    this.#started.resolve();
  }

  async send() {
    return { id: "1" };
  }
}

test("waits longer after each failed start, and from the first wait after one that ran a while", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const channel = new FailingChannel();
  const waits: number[] = [];

  await server.connectAddress({ account: codex, word: "codex" });

  const receivers = createReceivers({
    channel,
    webhookSecret: "secret",
    addresses: server.services.addresses,
    receive: server.services.messages.receive,
    log: () => {},
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

  try {
    receivers.sync();
    await channel.up;
  } finally {
    receivers.stop();
    setSystemTime();
  }

  expect(waits).toEqual([second, 2 * second, second]);
});
