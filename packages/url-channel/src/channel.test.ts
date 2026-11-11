import { expect, test } from "bun:test";

import type { OutboundMessage } from "@artil/channels/contract";

import { UrlChannel, type UrlData, type UrlDelivery, type UrlRefusal } from "./channel";

const claude = { id: "claude01", name: "Claude" };

const codex = { id: "codex001", name: "Codex" };

type SetupOptions = { listening?: boolean; refusal?: UrlRefusal | null };

// A server that knows Claude and Codex, and hands over what the channel gives it.
function setup({ listening = true, refusal = null }: SetupOptions = {}) {
  const delivered: UrlDelivery[] = [];
  const admitted: { agentId: string; senderId: string; listed: boolean }[] = [];

  const channel = new UrlChannel({
    findAgent: async (id) => [claude, codex].find((agent) => agent.id === id),
    admit: async (options) => {
      admitted.push(options);

      return refusal;
    },
    isListening: async () => listening,
    handOver: async (delivery) => {
      delivered.push(delivery);

      return "message-1";
    },
  });

  return { channel, delivered, admitted };
}

function message(fields: Partial<OutboundMessage<UrlData>>): OutboundMessage<UrlData> {
  return {
    from: claude.id,
    fromName: claude.name,
    credentials: null,
    to: [codex.id],
    cc: [],
    subject: null,
    text: "Review the PR",
    files: [],
    inReplyTo: null,
    ...fields,
  };
}

test("hands a message from one agent to another whole", async () => {
  const { channel, delivered } = setup();

  const sent = await channel.send(
    message({ channelData: { thread: "t1", toThread: null, client: "Claude Code" } }),
  );

  expect(sent).toEqual({ externalId: "message-1" });
  expect(delivered).toEqual([
    {
      from: claude,
      to: codex,
      text: "Review the PR",
      files: [],
      thread: "t1",
      toThread: null,
      client: "Claude Code",
    },
  ]);
});

test("sends to one agent, copying no one, in up to 2000 characters", async () => {
  const { channel, delivered } = setup();

  await expect(channel.send(message({ to: [codex.id, claude.id] }))).rejects.toThrow(
    "Put the id of the one agent to send to in to",
  );
  await expect(channel.send(message({ cc: [claude.id] }))).rejects.toThrow(
    "A message on url copies no one",
  );
  await expect(channel.send(message({ text: "a".repeat(2001) }))).rejects.toThrow(
    "A message on url holds at most 2000 characters",
  );
  expect(delivered).toEqual([]);
});

test("takes messages from the server's agents only, while someone listens", async () => {
  await expect(setup().channel.send(message({ from: "stranger" }))).rejects.toThrow(
    "Only the team can send here",
  );
  await expect(setup({ listening: false }).channel.send(message({}))).rejects.toThrow(
    "No one is listening to Codex",
  );
});

test("says why the agent does not take a message, as the server's list decides", async () => {
  const sender = setup({ refusal: { code: "sender", reason: "" } });
  const busy = setup({ refusal: { code: "rate_limit", reason: "" } });

  await expect(sender.channel.send(message({}))).rejects.toMatchObject({
    code: "forbidden",
    message: "Codex does not take messages from you at its Message URL",
  });
  await expect(busy.channel.send(message({}))).rejects.toMatchObject({ code: "rate_limited" });
});

test("lets an agent write to itself only from one thread to another, whatever its list says", async () => {
  const { channel, admitted } = setup();
  const toItself = message({ to: [claude.id] });

  await expect(channel.send(toItself)).rejects.toThrow("cannot send to its own Message URL");

  expect(
    await channel.send({
      ...toItself,
      channelData: { thread: "t1", toThread: "t2", client: null },
    }),
  ).toEqual({ externalId: "message-1" });
  expect(admitted).toEqual([{ agentId: claude.id, senderId: claude.id, listed: true }]);
});
