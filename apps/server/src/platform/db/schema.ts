import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { encryptedText } from "./encryption";

// What the database keeps of who wakes an agent: a list's setting, why a message did not wake the
// agent, and how one that did got in.
export const admits = ["anyone", "team", "list"] as const;

export const refusals = ["self", "spam", "sender", "outsider", "unverified"] as const;

export const admissions = ["team", "listed", "anyone"] as const;

function id() {
  return text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
}

function timestamp(name: string) {
  return integer(name, { mode: "timestamp_ms" });
}

function createdAt() {
  return timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date());
}

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  // The CLI picks an account by its name, in any case.
  (table) => [uniqueIndex("accounts_name_idx").on(sql`lower(${table.name})`)],
);

export const tokens = sqliteTable(
  "tokens",
  {
    id: id(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    hash: text("hash").notNull().unique(),
    // Whom the token was issued to, like "artil on MacBook" or an MCP client's name.
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("tokens_account_id_idx").on(table.accountId)],
);

// A sign-in a client asked for: pending until someone picks an account on the sign-in page, then
// holding the code the client trades for a token, once.
export const signIns = sqliteTable("sign_ins", {
  id: id(),
  kind: text("kind", { enum: ["cli", "oauth"] }).notNull(),
  // An MCP client registers itself, and only the same client may trade the code.
  clientId: text("client_id"),
  clientName: text("client_name").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  challenge: text("challenge").notNull(),
  state: text("state"),
  accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").unique(),
  expiresAt: timestamp("expires_at").notNull(),
});

// A bot keeps its row once disconnected, without its token, so the messages it carried stay; one
// account at a time holds it.
export const addresses = sqliteTable(
  "addresses",
  {
    id: id(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    value: text("value").notNull(),
    credentials: encryptedText("addresses", "credentials"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("addresses_channel_value_idx")
      .on(table.channel, table.value)
      .where(sql`${table.credentials} is not null`),
    index("addresses_account_id_idx").on(table.accountId),
  ],
);

export const access = sqliteTable(
  "access",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    admit: text("admit", { enum: admits }).notNull(),
    senders: text("senders", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.channel] })],
);

export const messages = sqliteTable(
  "messages",
  {
    id: id(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    addressId: text("address_id")
      .notNull()
      .references(() => addresses.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    // The provider's id for the message, which a provider that delivers twice repeats. Bots number
    // their messages each on their own, so it tells messages apart only at one address.
    externalId: text("external_id"),
    counterpart: text("counterpart").notNull(),
    counterpartName: encryptedText("messages", "counterpart_name"),
    to: text("to", { mode: "json" }).$type<string[]>().notNull(),
    text: encryptedText("messages", "text").notNull(),
    status: text("status", {
      enum: ["received", "refused", "sending", "sent", "failed"],
    }).notNull(),
    refusal: text("refusal", { enum: refusals }),
    admission: text("admission", { enum: admissions }),
    error: text("error"),
    createdAt: createdAt(),
  },
  (table) => [
    index("messages_account_id_created_at_idx").on(table.accountId, table.createdAt),
    uniqueIndex("messages_address_id_external_id_idx")
      .on(table.addressId, table.direction, table.externalId)
      .where(sql`${table.externalId} is not null`),
  ],
);

export const files = sqliteTable(
  "files",
  {
    id: id(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // A message's id, or the id of a relayed message, which keeps no other row.
    messageId: text("message_id").notNull(),
    name: encryptedText("files", "name").notNull(),
    type: text("type").notNull(),
    size: integer("size").notNull(),
    // Where the bytes are in the bucket; null when the server kept only the file's description.
    key: text("key"),
    // When the file goes, for the files of a relayed message.
    expiresAt: timestamp("expires_at"),
    createdAt: createdAt(),
  },
  (table) => [index("files_message_id_idx").on(table.messageId)],
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["message.received"] }).notNull(),
    channel: text("channel").notNull(),
    messageId: text("message_id").notNull(),
    // A message on a channel without an inbox comes whole in its event, which names its sender.
    text: encryptedText("events", "text"),
    sender: text("sender", { mode: "json" }).$type<{ id: string; name: string }>(),
    thread: text("thread"),
    toThread: text("to_thread"),
    client: text("client"),
    createdAt: createdAt(),
  },
  (table) => [index("events_account_id_id_idx").on(table.accountId, table.id)],
);

// The one client that hears an account's new messages.
export const connections = sqliteTable("connections", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  tokenHash: text("token_hash")
    .notNull()
    .references(() => tokens.hash, { onDelete: "cascade" }),
  client: text("client").notNull(),
  machine: text("machine"),
  // The client hears the events after this one: those since it connected, or since the last event
  // it was sent when it comes back.
  startsAfter: integer("starts_after").notNull(),
  listenedAt: timestamp("listened_at"),
});
