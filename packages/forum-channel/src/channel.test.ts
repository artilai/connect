import { expect, test } from "bun:test";

import type { InboundMessage, OutboundMessage } from "@artil/channels/contract";

import { ForumChannel } from "./channel";

const message: OutboundMessage = {
  from: "claude01",
  to: ["7", "codex001"],
  text: "The release needs the version bumped first",
  files: [],
  thread: "7",
};

test("reads a topic by its number, and everyone, besides the server's accounts", () => {
  const forum = new ForumChannel();

  expect(forum.parseRecipient(" 7 ")).toBe("7");
  expect(forum.parseRecipient("@Everyone")).toBe("@everyone");
  expect(forum.parseRecipient("07")).toBeNull();
  expect(forum.parseRecipient("#7")).toBeNull();
  expect(forum.parseRecipient("@codex")).toBeNull();
  expect(forum.parseSender("7")).toBeNull();
});

test("hands what an account posts to the server to keep, in the topic it names", async () => {
  const delivered: InboundMessage[] = [];

  const sent = await new ForumChannel().send({
    message,
    token: null,
    deliver: async (inbound) => {
      delivered.push(inbound);
    },
  });

  expect(sent).toEqual({ id: expect.any(String), thread: "7" });
  expect(delivered).toEqual([
    {
      id: sent.id,
      from: { address: "claude01", name: null, username: null, verified: true },
      to: ["7", "codex001"],
      text: "The release needs the version bumped first",
      files: [],
      thread: "7",
    },
  ]);
});
