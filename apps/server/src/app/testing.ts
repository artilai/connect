import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  Channel,
  type ChannelDefinition,
  type ChannelEvent,
  contractVersion,
  type HandleWebhookOptions,
  type InboundFile,
  type OutboundMessage,
  type StartOptions,
} from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import { createReceivers } from "../domains/channels/receivers";
import type { ChannelKind } from "../domains/channels/schema";
import type { Event } from "../domains/events/schema";
import { createPasswordCheck, hashPassword } from "../domains/sign-in/password";
import { pkceChallenge, randomSecret } from "../platform/crypto";
import { openDatabase } from "../platform/db/connection";
import { createHosts } from "../platform/http/hosts";
import { createMemoryStore } from "../platform/storage";
import { createApp } from "./http";
import { createServices } from "./services";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

export const origin = "http://localhost:4747";

// What a test posts to the API.
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

const testInboundSchema = z.object({
  id: z.string(),
  to: z.string(),
  from: z.string(),
  text: z.string().default(""),
  fromHandle: z.string().nullable().default(null),
  // The group the message came in, by its address and name.
  group: z.object({ address: z.string(), name: z.string().nullable() }).optional(),
});

// A message someone sends to one of the test channel's addresses.
type TestInbound = z.input<typeof testInboundSchema> & { files?: InboundFile[] };

// Where the test channel's provider signs what it posts to the webhook.
export const testWebhookHeader = "x-test-secret";

// A channel of the contract that tests drive in place of a provider, so the server is tested
// through the contract alone. An address is a word with an @ before it, which the server starts
// on to hand over what a test queued for it; a webhook takes a message posted with the secret,
// and the channel keeps what the server sends.
class TestChannel extends Channel<"test"> {
  readonly kind = "test";

  readonly name = "Test";

  readonly recipients = "someone who wrote to the address first, or another @address";

  override readonly senders = "a name, @handle or -group";

  override readonly credentials = "A word, which names the address @word";

  readonly sent: OutboundMessage[] = [];

  // What the server started on, which a test waits for.
  readonly started: Promise<void>[] = [];

  readonly #secret: string;

  readonly #queued = new Map<string, ChannelEvent[]>();

  constructor(secret: string) {
    super();
    this.#secret = secret;
  }

  // Queues a message for the address the word names, which comes when the server starts on it.
  queue(word: string, inbound: TestInbound) {
    this.#queued.set(word, [...(this.#queued.get(word) ?? []), toTestEvent(inbound)]);
  }

  override async connect(credentials: string) {
    return { address: `@${credentials}`, credentials };
  }

  override readSender(input: string) {
    return /^(?:@?\w+|-\d+)$/v.test(input.trim()) ? input.trim().toLowerCase() : null;
  }

  override recipientWritesFirst(recipient: string) {
    return !recipient.startsWith("@");
  }

  override start({ credentials, receive }: StartOptions) {
    const events = this.#queued.get(credentials) ?? [];

    this.#queued.delete(credentials);

    const handedOver = receive(events);

    this.started.push(handedOver);

    return handedOver;
  }

  override async handleWebhook(request: Request, { receive }: HandleWebhookOptions) {
    if (request.headers.get(testWebhookHeader) !== this.#secret) {
      throw new AppError({ code: "unauthorized", message: "Invalid webhook secret" });
    }

    await receive([toTestEvent(testInboundSchema.parse(await request.json()))]);

    return new Response(null, { status: 204 });
  }

  async send(message: OutboundMessage) {
    this.sent.push(message);

    return { externalId: `out-${this.sent.length}` };
  }
}

function toTestEvent({ files = [], ...inbound }: TestInbound): ChannelEvent {
  const { id, to, from, text, fromHandle, group } = testInboundSchema.parse(inbound);

  return {
    type: "message.received",
    message: {
      externalId: id,
      to,
      from: { address: from, name: null, handle: fromHandle, verified: true },
      ...(group && { group }),
      text,
      files,
    },
  };
}

const contractPath = fileURLToPath(
  new URL("../../../../packages/channels/src/contract.ts", import.meta.url),
);

// The source of a channel of someone's own, as a module beside the server's data would hold one,
// built for the contract's version unless a test names another.
export function channelModule(kind: string, builtFor = contractVersion) {
  return `import { Channel } from ${JSON.stringify(contractPath)};

class EchoChannel extends Channel {
  contractVersion = ${builtFor};
  kind = ${JSON.stringify(kind)};
  name = "Echo";
  recipients = "any name";

  async connect(credentials) {
    return { address: "echo:" + credentials, credentials };
  }

  async send() {
    return { externalId: "1" };
  }
}

export const channel = { kind: ${JSON.stringify(kind)}, create: () => new EchoChannel() };
`;
}

// The test channel as a config loads one, for tests of the commands.
export const testChannelDefinition = {
  kind: "test",
  create: ({ secret }) => new TestChannel(secret),
} satisfies ChannelDefinition<"test">;

// A port nothing listens on now, for a test that starts the server on a port of its own.
export async function findFreePort() {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port ?? 0;

  await probe.stop(true);

  return port;
}

type CreateTestServerOptions = {
  // The password the sign-in page asks for.
  password?: string;
  publicUrl?: string;
  files?: boolean;
};

type CallOptions = RequestInit & { token?: string };

// Signs file links and makes the key the database and the bucket encrypt with.
const secret = "secret-of-the-test-server-of-at-least-32-chars";

// The whole server on an in-memory database, answering requests without a port.
export async function createTestServer({
  password,
  publicUrl,
  files = true,
}: CreateTestServerOptions = {}) {
  const database = openDatabase({ path: ":memory:", migrationsFolder, secret });
  const testChannel = new TestChannel("webhook-secret");
  const memory = createMemoryStore();
  const baseUrl = publicUrl ?? origin;
  const hashed = password === undefined ? null : await hashPassword(password);

  const channels = new Map<ChannelKind, Channel>([["test", testChannel]]);
  // What the server logs, as its terminal shows it.
  const logs: string[] = [];

  const services = createServices({
    db: database.db,
    secret,
    baseUrl,
    store: files ? memory.store : undefined,
    channels,
    log: (line) => logs.push(line),
  });

  const app = createApp({
    services,
    hosts: createHosts({ publicUrl }),
    password: createPasswordCheck({ hash: async () => hashed }),
    workspace: { id: crypto.randomUUID(), name: "test", ownerId: crypto.randomUUID() },
    log: () => {},
  });

  const host = new URL(baseUrl).host;

  function call(path: string, { token, headers, ...init }: CallOptions = {}) {
    const merged = new Headers(headers);

    merged.set("host", host);

    if (token) merged.set("authorization", `Bearer ${token}`);

    return app.request(path, { ...init, headers: merged });
  }

  // An account signed in with a token of its own.
  function account(name: string) {
    const created = services.accounts.create(name);
    const token = services.tokens.issue({ accountId: created.id, name: `${name}'s client` });

    return {
      ...created,
      token,
      call: (path: string, init: CallOptions = {}) => call(path, { ...init, token }),
      json: (path: string, body: Json) =>
        call(path, {
          method: "POST",
          token,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
    };
  }

  type ConnectAddressOptions = { account: TestAccountRecord; word: string };

  // Connects the test channel's address @word to the account.
  async function connectAddress({ account: owner, word }: ConnectAddressOptions) {
    const { address } = await services.addresses.connect({
      accountId: owner.id,
      kind: "test",
      credentials: word,
    });

    return address.value;
  }

  // Starts the test channel on its connected addresses, the way the server does, and waits until
  // each handed over what was queued for it.
  async function deliverQueued() {
    const receivers = createReceivers({
      channel: testChannel,
      addresses: services.addresses,
      receive: services.messages.receive,
      log: () => {},
    });

    receivers.sync();
    await Promise.all(testChannel.started.splice(0));
    receivers.stop();
  }

  return {
    services,
    logs,
    app,
    call,
    account,
    testChannel,
    connectAddress,
    deliverQueued,
    memory,
    database,
  };
}

type TestAccountRecord = { id: string };

export type TestServer = Awaited<ReturnType<typeof createTestServer>>;

export type TestAccount = ReturnType<TestServer["account"]>;

// A PKCE pair, as a client makes one for each sign-in.
export function pkce() {
  const verifier = randomSecret();

  return { verifier, challenge: pkceChallenge(verifier) };
}

type StreamedEvent = Omit<Event, "createdAt"> & { createdAt: string };

// Connects a client to the account, as one does before it listens.
export async function connectClient(account: TestAccount, client = "test client") {
  const response = await account.call(`/api/agents/${account.id}/connection`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client, machine: "test machine" }),
  });

  return z.object({ id: z.uuid() }).parse(await response.json()).id;
}

// Opens the account's event stream at this query, and reads its events as they come.
export async function openStream(account: TestAccount, query = "") {
  const controller = new AbortController();

  const response = await account.call(`/api/agents/${account.id}/events/stream${query}`, {
    signal: controller.signal,
  });

  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";

  // The next event's data, parsed; heartbeats carry none.
  async function next(): Promise<StreamedEvent> {
    while (!buffered.includes("\n\n")) {
      const chunk = await reader?.read();

      if (!chunk || chunk.done) throw new Error("The stream ended");

      buffered += chunk.value;
    }

    const end = buffered.indexOf("\n\n");
    const block = buffered.slice(0, end);

    buffered = buffered.slice(end + 2);

    const data = block
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice("data: ".length);

    // SAFETY: the server writes each event's data as an Event in JSON, with its date as a string.
    return data === undefined ? next() : (JSON.parse(data) as StreamedEvent);
  }

  return {
    response,
    next,

    close() {
      controller.abort();
    },
  };
}

// Opens the account's event stream as a client that connected, and reads its events as they come.
export async function listen(account: TestAccount, client = "test client") {
  const connectionId = await connectClient(account, client);

  return { ...(await openStream(account, `?connection=${connectionId}`)), connectionId };
}
