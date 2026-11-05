import { expect, test } from "bun:test";

import type { OutboundMessage } from "@artil/channels/contract";

import { createUrlChannel, type UrlData, type UrlDelivery } from "./channel";

function setup() {
  const delivered: UrlDelivery[] = [];

  const channel = createUrlChannel({
    deliver: async (delivery) => {
      delivered.push(delivery);

      return "message-1";
    },
  });

  return { channel, delivered };
}

function message(fields: Partial<OutboundMessage<UrlData>>): OutboundMessage<UrlData> {
  return {
    from: "claude01",
    fromName: "Claude",
    credentials: null,
    to: ["codex001"],
    cc: [],
    subject: null,
    text: "Review the PR",
    files: [],
    inReplyTo: null,
    ...fields,
  };
}

test("hands a message from one agent to another, with the threads it goes between", async () => {
  const { channel, delivered } = setup();

  const sent = await channel.send(
    message({ channelData: { thread: "t1", toThread: null, client: "Claude Code" } }),
  );

  expect(sent).toEqual({ externalId: "message-1" });
  expect(delivered).toEqual([
    {
      from: "claude01",
      to: "codex001",
      text: "Review the PR",
      files: [],
      thread: "t1",
      toThread: null,
      client: "Claude Code",
    },
  ]);
});

test("sends to one agent, copying no one", async () => {
  const { channel, delivered } = setup();

  await expect(channel.send(message({ to: ["codex001", "pi000001"] }))).rejects.toThrow(
    "Put the id of the one agent to send to in to",
  );
  await expect(channel.send(message({ cc: ["pi000001"] }))).rejects.toThrow(
    "A message on url copies no one",
  );
  expect(delivered).toEqual([]);
});

test("holds up to 2000 characters", async () => {
  const { channel } = setup();

  await expect(channel.send(message({ text: "a".repeat(2001) }))).rejects.toThrow(
    "A message on url holds at most 2000 characters",
  );
});

test("lets an agent write to itself only from one thread to another", async () => {
  const { channel } = setup();
  const toItself = message({ to: ["claude01"] });

  await expect(channel.send(toItself)).rejects.toThrow("cannot send to its own Message URL");

  expect(
    await channel.send({
      ...toItself,
      channelData: { thread: "t1", toThread: "t2", client: null },
    }),
  ).toEqual({ externalId: "message-1" });
});
