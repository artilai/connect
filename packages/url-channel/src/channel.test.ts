import { expect, test } from "bun:test";

import type { InboundMessage, OutboundMessage } from "@artil/channels/contract";

import { UrlChannel } from "./channel";

const notes = {
  name: "notes.txt",
  type: "text/plain",
  size: 2,
  content: new TextEncoder().encode("Hi"),
};

const message: OutboundMessage = {
  from: "claude01",
  to: ["codex001"],
  text: "Review the PR",
  files: [notes],
  replyTo: "42",
};

test("hands what an account sends to the server to deliver, under the id it returns", async () => {
  const delivered: InboundMessage[] = [];

  const sent = await new UrlChannel().send({
    message,
    token: null,
    deliver: async (inbound) => {
      delivered.push(inbound);
    },
  });

  expect(delivered).toEqual([
    {
      id: sent.id,
      from: { address: "claude01", name: null, username: null, verified: true },
      to: ["codex001"],
      text: "Review the PR",
      files: [notes],
      replyTo: "42",
    },
  ]);
});

test("fails to send what the server does not deliver", async () => {
  const sending = new UrlChannel().send({
    message,
    token: null,
    deliver: async () => {
      throw new Error("Codex does not take messages from Claude");
    },
  });

  await expect(sending).rejects.toThrow("Codex does not take messages from Claude");
});
