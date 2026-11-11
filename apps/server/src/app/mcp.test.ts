import { expect, test } from "bun:test";

import {
  auth,
  type CallToolRequest,
  Client,
  type OAuthClientProvider,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { z } from "zod";

import { createTestServer, listen, origin, type TestAccount, type TestServer } from "./testing";

type ConnectOptions = { server: TestServer; account: TestAccount };

async function connect({ server, account }: ConnectOptions) {
  const client = new Client(
    { name: "chatgpt", version: "0.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );

  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);

      headers.set("authorization", `Bearer ${account.token}`);

      return server.call(new URL(url).pathname, { ...init, headers });
    },
  });

  await client.connect(transport);

  return client;
}

type CallOptions = {
  client: Client;
  name: string;
  args?: CallToolRequest["params"]["arguments"];
};

async function call({ client, name, args = {} }: CallOptions) {
  const result = await client.callTool({ name, arguments: args });
  const [content] = result.content;
  const text = content?.type === "text" ? content.text : "";

  return { isError: result.isError ?? false, text, json: () => JSON.parse(text) };
}

test("lists its tools for the account the token signs in as", async () => {
  const server = await createTestServer();
  const client = await connect({ server, account: server.account("Codex") });

  const { tools } = await client.listTools();

  expect(tools.map(({ name }) => name).toSorted()).toEqual([
    "messages.list",
    "messages.read",
    "messages.send",
    "status",
    "team.list",
  ]);
});

test("shows the account and its team", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const client = await connect({ server, account: codex });

  server.account("Claude");

  expect((await call({ client, name: "status" })).json()).toEqual({
    agent: { id: codex.id, name: "Codex" },
    addresses: [],
    signedInBy: null,
  });

  expect((await call({ client, name: "team.list" })).json()).toEqual([
    expect.objectContaining({ name: "Codex", listening: false }),
    expect.objectContaining({ name: "Claude", listening: false }),
  ]);
});

test("sends to another account's Message URL and answers what came there", async () => {
  const server = await createTestServer();
  const chatgpt = server.account("ChatGPT");
  const codex = server.account("Codex");
  const codexStream = await listen(codex);
  const client = await connect({ server, account: chatgpt });

  const sent = await call({
    client,
    name: "messages.send",
    args: { channel: "url", to: ["Codex"], text: "Plan the launch" },
  });

  expect(sent.isError).toBe(false);

  const { id } = z.object({ id: z.uuid() }).parse(sent.json());

  expect((await call({ client, name: "messages.read", args: { id } })).json()).toMatchObject({
    channel: "url",
    direction: "outbound",
    to: [codex.id],
    text: "Plan the launch",
    status: "sent",
  });

  const chatgptStream = await listen(chatgpt);
  const { messageId } = await codexStream.next();

  await codex.json(`/api/agents/${codex.id}/messages`, { replyTo: messageId, text: "Done" });

  const done = await chatgptStream.next();

  expect(
    (await call({ client, name: "messages.read", args: { id: done.messageId } })).json(),
  ).toMatchObject({ direction: "inbound", fromName: "Codex", text: "Done" });

  const answer = await call({
    client,
    name: "messages.send",
    args: { replyTo: done.messageId, text: "Thanks" },
  });

  expect(answer.isError).toBe(false);

  const thanks = await codexStream.next();
  const read = await codex.call(`/api/agents/${codex.id}/messages/${thanks.messageId}`);

  expect(await read.json()).toMatchObject({ counterpart: chatgpt.id, text: "Thanks" });

  codexStream.close();
  chatgptStream.close();
});

test("sends on the Message URL to one account, copying no one, in up to 2000 characters", async () => {
  const server = await createTestServer();
  const claude = server.account("Claude");
  const codex = server.account("Codex");
  const client = await connect({ server, account: server.account("ChatGPT") });

  async function send(draft: CallToolRequest["params"]["arguments"]) {
    return (await call({ client, name: "messages.send", args: { channel: "url", ...draft } })).text;
  }

  expect(await send({ to: [codex.id, claude.id], text: "Hi" })).toBe(
    "A Message URL message goes to one recipient",
  );
  expect(await send({ to: [codex.id], cc: [claude.id], text: "Hi" })).toBe(
    "A message on url copies no one",
  );
  expect(await send({ to: [codex.id], text: "a".repeat(2001) })).toBe(
    "A Message URL message holds at most 2000 characters",
  );
});

test("refuses a message its channel cannot carry, before it keeps one", async () => {
  const server = await createTestServer();
  const codex = server.account("Codex");
  const client = await connect({ server, account: codex });

  await server.connectAddress({ account: codex, word: "codex" });

  async function send(draft: CallToolRequest["params"]["arguments"]) {
    const args = { channel: "test", to: ["@ada"], text: "Hi", ...draft };

    return (await call({ client, name: "messages.send", args })).text;
  }

  type NoteOptions = { name: string; text: string };

  function note({ name, text }: NoteOptions) {
    return { name, type: "text/plain", text };
  }

  expect(await send({ to: ["@ada", "@eve"] })).toBe("A Test message goes to one recipient");
  expect(await send({ to: ["not a recipient!"] })).toBe(
    "not a recipient! is not a Test name, @handle or -group",
  );
  expect(await send({ text: "a".repeat(101) })).toBe("A Test message holds at most 100 characters");
  expect(
    await send({
      attachments: ["a", "b", "c"].map((name) => note({ name: `${name}.txt`, text: name })),
    }),
  ).toBe("A Test message carries up to 2 files");
  expect(await send({ attachments: [note({ name: "a.txt", text: "a".repeat(11) })] })).toBe(
    "a.txt is 11 B; Test takes files of up to 10 B",
  );
  expect(server.services.messages.list({ accountId: codex.id, filter: {} })).toEqual([]);
});

test("acts as its own account only", async () => {
  const server = await createTestServer();
  const client = await connect({ server, account: server.account("Codex") });
  const claude = server.account("Claude");

  const result = await call({ client, name: "messages.list", args: { agent: claude.id } });

  expect(result).toMatchObject({
    isError: true,
    text: "These tools act as one account only",
  });
});

test("refuses to list by an empty channel", async () => {
  const server = await createTestServer();
  const client = await connect({ server, account: server.account("Codex") });

  const result = await call({ client, name: "messages.list", args: { channel: "" } });

  expect(result.isError).toBe(true);
  expect(result.text).toContain("channel");
});

// A client that keeps its registration and tokens in memory and hands the sign-in link to the test.
function memoryProvider(redirectUrl: string) {
  let client: StoredOAuthClientInformation | undefined;
  let tokens: StoredOAuthTokens | undefined;
  let verifier = "";
  const links: URL[] = [];

  const provider: OAuthClientProvider = {
    redirectUrl,
    clientMetadata: { client_name: "Claude Code", redirect_uris: [redirectUrl] },
    clientInformation: () => client,
    saveClientInformation: (saved) => {
      client = saved;
    },
    tokens: () => tokens,
    saveTokens: (saved) => {
      tokens = saved;
    },
    redirectToAuthorization: (link) => {
      links.push(link);
    },
    saveCodeVerifier: (saved) => {
      verifier = saved;
    },
    codeVerifier: () => verifier,
  };

  return { provider, links, tokens: () => tokens };
}

test("signs a client in the way the MCP SDK does, from discovery to a token", async () => {
  const server = await createTestServer();
  const account = server.services.accounts.create("Claude");
  const memory = memoryProvider("http://127.0.0.1:33418/callback");

  async function fetchFn(url: string | URL, init?: RequestInit) {
    const { pathname, search } = new URL(url);

    return server.call(pathname + search, init);
  }

  expect(await auth(memory.provider, { serverUrl: `${origin}/mcp`, fetchFn })).toBe("REDIRECT");

  const [link] = memory.links;

  const page =
    (await server.call(`${link?.pathname}${link?.search}`)).headers.get("location") ?? "";

  const allowed = await server.call(page, {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ decision: "allow", account: account.id }).toString(),
  });

  const redirect = new URL(allowed.headers.get("location") ?? "");

  const authorized = await auth(memory.provider, {
    serverUrl: `${origin}/mcp`,
    authorizationCode: redirect.searchParams.get("code") ?? "",
    iss: redirect.searchParams.get("iss") ?? "",
    fetchFn,
  });

  expect(authorized).toBe("AUTHORIZED");

  const token = memory.tokens()?.access_token ?? "";

  expect(await (await server.call("/api/me", { token })).json()).toMatchObject({
    identityId: account.id,
  });
});
