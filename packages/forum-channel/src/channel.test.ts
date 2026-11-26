import { expect, setSystemTime, test } from "bun:test";

import type { InboundMessage, OutboundMessage } from "@artil/channels/contract";
import { createMemoryState } from "@artil/channels/testing";
import { minute } from "@artil/utils/time";

import { ForumChannel } from "./channel";

type Post = Pick<OutboundMessage, "from"> & Partial<OutboundMessage>;

// The server's accounts, by name, and their addresses on the forum.
const accounts = new Map([
  ["claude", "claude01"],
  ["codex", "codex001"],
  ["gemini", "gemini01"],
]);

function createForum() {
  const forum = new ForumChannel();
  const state = createMemoryState();

  async function post(message: Post) {
    const delivered: InboundMessage[] = [];

    const sent = await forum.send({
      message: { to: [], text: "Hi", files: [], ...message },
      token: null,
      state,
      addressOf: (account) => accounts.get(account.toLowerCase()) ?? null,
      deliver: async (inbound) => {
        delivered.push(inbound);
      },
    });

    const [inbound] = delivered;

    if (!inbound || inbound.id !== sent.id) throw new Error("The forum delivered no post");

    return inbound;
  }

  return { forum, post };
}

test("reads a topic by its number, with or without a #, besides the server's accounts", () => {
  const { forum } = createForum();

  expect(forum.parseRecipient(" 7 ")).toBe("#7");
  expect(forum.parseRecipient("#7")).toBe("#7");
  expect(forum.parseRecipient("07")).toBeNull();
  expect(forum.parseRecipient("@everyone")).toBeNull();
  expect(forum.parseSender("7")).toBeNull();
});

test("starts a topic under its subject, which wakes no one", async () => {
  const { post } = createForum();

  const opened = await post({
    from: "claude01",
    subject: "How do we release?",
    text: "Bump the version first",
  });

  expect(opened).toEqual({
    id: expect.any(String),
    from: { address: "claude01", name: null, username: null, verified: true },
    to: [],
    group: { address: "1", name: "How do we release?" },
    subject: "How do we release?",
    text: "Bump the version first",
    files: [],
    replyTo: undefined,
    thread: "1",
  });
});

test("calls accounts to a new topic under its first line, by to or by a mention, and wakes them", async () => {
  const { post } = createForum();

  const opened = await post({
    from: "claude01",
    to: ["codex001"],
    text: "Release checklist\n@Gemini, @claude: what goes in it? Not @types/node, nor ada@codex.dev",
  });

  expect(opened).toMatchObject({
    to: ["codex001", "gemini01"],
    group: { address: "1", name: "Release checklist" },
    subject: "Release checklist",
  });
});

test("wakes whoever takes part in a topic, and keeps an answer in it", async () => {
  const { post } = createForum();

  await post({ from: "claude01", text: "Flaky test" });

  const fromCodex = await post({ from: "codex001", to: ["#1"], text: "It hangs, @gemini?" });

  expect(fromCodex).toMatchObject({ to: ["claude01", "gemini01"], subject: "Flaky test" });

  // The server names the topic of the post an answer answers as its thread, and as its sender.
  const answer = await post({ from: "claude01", to: ["#1"], thread: "1", text: "Fixed" });

  expect(answer).toMatchObject({ to: ["codex001", "gemini01"], thread: "1" });
});

test("says what a post cannot name", async () => {
  const { post } = createForum();

  await post({ from: "claude01", text: "Release" });
  await post({ from: "claude01", text: "Bucket" });

  const refusals: [Omit<Post, "from">, string][] = [
    [{ to: ["#1", "#2"] }, "A post goes in one topic"],
    [{ to: ["#9"] }, "There is no topic 9 on the forum"],
    [{ to: ["#1"], subject: "Renamed" }, "Only a new topic takes a subject"],
    [{ to: ["#2"], thread: "1" }, "An answer stays in the topic of the post it answers"],
    [
      { text: " \n " },
      "A new topic takes a title: give a subject, or start the post with a line of text",
    ],
  ];

  for (const [message, refusal] of refusals) {
    await expect(post({ from: "claude01", ...message })).rejects.toThrow(refusal);
  }
});

test("lets one account's posts wake another at most five times in ten minutes, in one topic or across new ones", async () => {
  const { post } = createForum();

  await post({ from: "claude01", to: ["codex001"], text: "Are you there?" });
  await post({ from: "claude01", to: ["#1"], text: "Hello?" });

  // A new topic for each post does not start the count anew.
  for (const text of ["Ping", "Ping again", "Last ping", "One more"]) {
    await post({ from: "claude01", to: ["codex001"], text });
  }

  const woken = await post({ from: "claude01", to: ["#1"], text: "Still there?" });

  expect(woken.to).toEqual([]);

  // Another account's post still wakes Codex.
  expect((await post({ from: "gemini01", to: ["codex001"], text: "Lunch?" })).to).toEqual([
    "codex001",
  ]);

  setSystemTime(new Date(Date.now() + 10 * minute));

  try {
    expect((await post({ from: "claude01", to: ["#1"], text: "Back now?" })).to).toEqual([
      "codex001",
    ]);
  } finally {
    setSystemTime();
  }
});
