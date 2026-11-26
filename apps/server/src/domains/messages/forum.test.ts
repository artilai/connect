import { expect, test } from "bun:test";

import { z } from "zod";

import { createTestServer, type TestAccount } from "../../app/testing";

const postedSchema = z.looseObject({ id: z.uuid() });

const eventsSchema = z.array(
  z.looseObject({ messageId: z.uuid(), toThread: z.string().nullable() }),
);

// What a post gives the API, field by field, as JSON.
type Post = { readonly [field: string]: Parameters<TestAccount["json"]>[1] };

// Posts on the forum as the account, and returns the post.
async function post(account: TestAccount, body: Post) {
  const response = await account.json(`/api/agents/${account.id}/messages`, {
    channel: "forum",
    ...body,
  });

  expect(response.status).toBe(201);

  return postedSchema.parse(await response.json());
}

// What woke the account: the posts, and the thread of its client each was for.
async function wokenBy(account: TestAccount) {
  const response = await account.call(`/api/agents/${account.id}/events?after=0`);

  return eventsSchema
    .parse(await response.json())
    .map(({ messageId, toThread }) => ({ messageId, toThread }));
}

async function listForum(account: TestAccount, query = "") {
  const response = await account.call(
    `/api/agents/${account.id}/messages?channel=forum&direction=inbound${query}`,
  );

  return z.array(z.looseObject({ id: z.uuid() })).parse(await response.json());
}

test("starts a topic for everyone, which every account reads and none is woken by", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");

  const sent = await claude.json(`/api/agents/${claude.id}/messages`, {
    channel: "forum",
    to: ["@everyone"],
    subject: "How do we release?",
    text: "Bump the version in apps/server/package.json, then merge.",
  });

  expect(sent.status).toBe(201);

  const posted = postedSchema.parse(await sent.json());

  expect(posted).toMatchObject({
    channel: "forum",
    direction: "inbound",
    counterpart: "1",
    counterpartName: "How do we release?",
    subject: "How do we release?",
    author: claude.id,
    authorName: "Claude",
    to: [],
    text: "Bump the version in apps/server/package.json, then merge.",
    status: "received",
    admission: "team",
  });

  expect(await listForum(codex)).toEqual([posted]);
  expect(await (await codex.call(`/api/agents/${codex.id}/messages/${posted.id}`)).json()).toEqual(
    posted,
  );
  expect(await wokenBy(codex)).toEqual([]);
});

test("calls accounts to a new topic, which wakes them, and names it by its first line", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");

  const posted = await post(claude, {
    to: ["Codex"],
    text: "Release checklist\nWhat goes in it before 0.7.0?",
  });

  expect(posted).toMatchObject({
    counterpart: "1",
    counterpartName: "Release checklist",
    subject: "Release checklist",
    to: [codex.id],
  });
  expect(await wokenBy(codex)).toEqual([{ messageId: posted.id, toThread: null }]);
  expect(await wokenBy(claude)).toEqual([]);
});

test("wakes whoever takes part in a topic, in the thread of their client that last posted there", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
  const gemini = server.account("Gemini");

  const opening = await post(claude, {
    to: ["@everyone"],
    subject: "Flaky test",
    text: "messages.test.ts fails on CI",
    thread: "ci",
  });

  // Codex takes part by posting, and calls Gemini besides.
  const fromCodex = await post(codex, {
    to: ["1", "Gemini"],
    text: "It waits on a stream that never ends",
    thread: "flaky",
  });

  expect(await wokenBy(claude)).toEqual([{ messageId: fromCodex.id, toThread: "ci" }]);
  expect(await wokenBy(gemini)).toEqual([{ messageId: fromCodex.id, toThread: null }]);
  expect(await wokenBy(codex)).toEqual([]);

  // An answer stays in the topic of the post it answers.
  const answer = await post(claude, { replyTo: fromCodex.id, text: "Fixed in #63" });

  expect(answer).toMatchObject({ counterpart: "1", to: [codex.id, gemini.id] });
  expect(await wokenBy(codex)).toEqual([{ messageId: answer.id, toThread: "flaky" }]);
  expect(await wokenBy(gemini)).toEqual([
    { messageId: fromCodex.id, toThread: null },
    { messageId: answer.id, toThread: null },
  ]);

  // A topic lists every post in it, the reader's own among them.
  expect((await listForum(codex, "&counterpart=1")).map(({ id }) => id).toSorted()).toEqual(
    [opening.id, fromCodex.id, answer.id].toSorted(),
  );
});

test("wakes no one whose list keeps the team out on the forum", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");

  server.services.access.setAdmit({ accountId: codex.id, channel: "forum", admit: "list" });

  const posted = await post(claude, { to: ["Codex"], text: "Review the release notes" });

  expect(await wokenBy(codex)).toEqual([]);
  expect(await listForum(codex)).toEqual([posted]);
});

test("removes an account's posts with it, and wakes the rest of its topics without it", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
  const gemini = server.account("Gemini");

  await post(claude, { to: ["Codex", "Gemini"], text: "Who owns the bucket?" });
  await server.services.accounts.remove(claude.id);

  const fromCodex = await post(codex, { to: ["1"], text: "Gemini does" });

  expect((await listForum(gemini)).map(({ id }) => id)).toEqual([fromCodex.id]);
  expect((await wokenBy(gemini)).at(-1)).toEqual({ messageId: fromCodex.id, toThread: null });
});

test("keeps the forum apart from an account's own messages, and gives it an address there", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");

  const posted = await post(claude, { to: ["@everyone"], text: "The bucket moved to R2" });

  const own = await (await codex.call(`/api/agents/${codex.id}/messages`)).json();
  const addresses = await (await codex.call(`/api/agents/${codex.id}/addresses`)).json();

  expect(own).toEqual([]);
  expect(await (await claude.call(`/api/agents/${claude.id}/messages`)).json()).toEqual([posted]);
  expect(addresses).toEqual([
    expect.objectContaining({ channel: "forum", value: codex.id }),
    expect.objectContaining({ channel: "url", value: codex.id }),
  ]);
});

test("says what a post on the forum cannot name, as the forum and the server say it", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");

  async function refused(body: Post) {
    const response = await claude.json(`/api/agents/${claude.id}/messages`, {
      channel: "forum",
      ...body,
    });

    return { status: response.status, body: await response.json() };
  }

  function error(status: number, message: string) {
    return { status, body: { error: { message } } };
  }

  expect(await refused({ to: ["9"], text: "Where?" })).toMatchObject(
    error(404, "There is no topic 9 on the forum"),
  );
  expect(await refused({ to: ["@claude"], text: "Hi" })).toMatchObject(
    error(400, "@claude is not a Forum topic number, account name or @everyone"),
  );
  expect(await refused({ to: ["@everyone"], cc: ["Claude"], text: "Hi" })).toMatchObject(
    error(400, "A message on forum copies no one"),
  );
});

test("keeps what the forum keeps of its topics encrypted at rest", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");

  await post(claude, { to: ["@everyone"], subject: "Where the keys live", text: "In 1Password" });

  const stored = server.database.db.$client
    .query<{ value: string }, []>("select value from channel_state")
    .all()
    .map(({ value }) => value);

  expect(stored.length).toBeGreaterThan(0);
  expect(stored.filter((value) => value.includes("keys"))).toEqual([]);
});

type SearchOptions = { account: TestAccount; words: string; topic?: string };

// The ids of the posts a search finds, in no particular order.
async function search({ account, words, topic }: SearchOptions) {
  const inTopic = topic ? `&counterpart=${topic}` : "";

  const found = await listForum(account, `&search=${encodeURIComponent(words)}${inTopic}`);

  return found.map(({ id }) => id).toSorted();
}

test("finds the posts that hold the words searched for, on the whole forum or in a topic", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");

  const release = await post(claude, {
    to: ["@everyone"],
    subject: "How do we release?",
    text: "Bump the version, then merge.",
  });

  const bucket = await post(codex, { to: ["@everyone"], text: "The bucket moved to R2" });
  const notes = await post(codex, { to: ["1"], text: "Write the notes in the PR" });
  const deploy = await post(codex, { to: ["@everyone"], text: "Как деплоить сервер\nЁлка" });

  expect(await search({ account: codex, words: "release" })).toEqual(
    [release.id, notes.id].toSorted(),
  );
  expect(await search({ account: codex, words: "Release, bucket?" })).toEqual(
    [release.id, notes.id, bucket.id].toSorted(),
  );
  expect(await search({ account: codex, words: "bucket", topic: "1" })).toEqual([]);
  expect(await search({ account: codex, words: "notes", topic: "1" })).toEqual([notes.id]);

  // A word matches without the marks on its letters, so деплой finds деплоить.
  expect(await search({ account: codex, words: "деплой" })).toEqual([deploy.id]);
  expect(await search({ account: codex, words: "елка" })).toEqual([deploy.id]);
});

test("puts the post that holds more of the words searched for first", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");

  await post(claude, { to: ["@everyone"], text: "The bucket moved" });
  const both = await post(claude, { to: ["@everyone"], text: "The bucket for the release moved" });

  expect((await listForum(claude, "&search=release+bucket"))[0]?.id).toBe(both.id);
});

test("says what a search cannot do", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const posted = await post(claude, { to: ["@everyone"], text: "Release" });

  async function refused(query: string) {
    const response = await claude.call(`/api/agents/${claude.id}/messages?${query}`);

    return { status: response.status, body: await response.json() };
  }

  expect(await refused("channel=forum&search=a+%3F")).toMatchObject({
    status: 400,
    body: { error: { message: "Search for words of 2 letters or more" } },
  });
  expect(await refused(`channel=forum&search=release&before=${posted.id}`)).toMatchObject({
    status: 400,
    body: {
      error: { message: "A search lists its best matches, so it pages back from no message" },
    },
  });
});

test("finds a post made after the first search, and none of a removed account's", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");

  const early = await post(claude, { to: ["@everyone"], text: "The release is out" });

  expect(await search({ account: codex, words: "release" })).toEqual([early.id]);

  const later = await post(codex, { to: ["1"], text: "The release notes are in the PR" });

  expect(await search({ account: codex, words: "release" })).toEqual(
    [early.id, later.id].toSorted(),
  );

  await server.services.accounts.remove(claude.id);

  expect(await search({ account: codex, words: "release" })).toEqual([later.id]);
});

test("finds the posts that remain when removed ones would have ranked first", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");

  const kept = await post(codex, { to: ["@everyone"], text: "The release is out" });

  for (const text of ["The release notes", "The release date", "The release plan"]) {
    await post(claude, { to: ["@everyone"], text });
  }

  // The first search fills the index, which still holds Claude's posts once Claude is removed.
  expect(await listForum(codex, "&search=release&limit=1")).toHaveLength(1);

  await server.services.accounts.remove(claude.id);

  expect((await listForum(codex, "&search=release&limit=1")).map(({ id }) => id)).toEqual([
    kept.id,
  ]);
});

test("sends on a file that came with another account's post", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");

  const posted = z.looseObject({ attachments: z.array(z.object({ id: z.uuid() }).loose()) }).parse(
    await post(claude, {
      to: ["@everyone"],
      text: "The checklist",
      attachments: [{ name: "checklist.txt", type: "text/plain", text: "Bump the version" }],
    }),
  );

  const [file] = posted.attachments;

  const answer = await codex.json(`/api/agents/${codex.id}/messages`, {
    channel: "url",
    to: ["Claude"],
    text: "This one?",
    attachments: [{ id: file?.id ?? "" }],
  });

  expect(answer.status).toBe(201);
  expect(await answer.json()).toMatchObject({ attachments: [{ name: "checklist.txt" }] });
});
