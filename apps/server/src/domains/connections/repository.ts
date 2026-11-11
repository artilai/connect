import { and, eq, gt } from "drizzle-orm";

import { second } from "@artil/utils/time";

import type { Database } from "../../platform/db/connection";
import { connections, tokens } from "../../platform/db/schema";
import type { ConnectionRecord } from "./schema";

// A client listens while its stream checked in lately, as one does every 30 seconds.
const listenWindow = 90 * second;

type ConnectOptions = {
  accountId: string;
  tokenHash: string;
  client: string;
  machine: string | null;
  // The account's last event, after which a client that is new to it starts.
  lastEventId: number;
};

type CheckInOptions = {
  accountId: string;
  id: string;
  // The last event the client was sent, after which it hears on when it comes back.
  cursor: number;
};

const columns = {
  id: connections.id,
  tokenId: tokens.id,
  client: connections.client,
  machine: connections.machine,
  startsAfter: connections.startsAfter,
};

export function createConnectionsRepository(db: Database) {
  function findByAccount(accountId: string): ConnectionRecord | undefined {
    return db
      .select(columns)
      .from(connections)
      .innerJoin(tokens, eq(tokens.hash, connections.tokenHash))
      .where(eq(connections.accountId, accountId))
      .get();
  }

  return {
    findByAccount,

    // Connects a client in place of any other. The same client coming back resumes where it left
    // off; another starts from now.
    connect({ accountId, tokenHash, client, machine, lastEventId }: ConnectOptions) {
      return db.transaction((tx) => {
        const current = tx
          .select()
          .from(connections)
          .where(eq(connections.accountId, accountId))
          .get();

        const sameClient =
          current?.tokenHash === tokenHash &&
          current.client === client &&
          current.machine === machine;

        const values = {
          id: crypto.randomUUID(),
          tokenHash,
          client,
          machine,
          startsAfter: sameClient ? current.startsAfter : lastEventId,
          listenedAt: null,
        };

        tx.insert(connections)
          .values({ accountId, ...values })
          .onConflictDoUpdate({ target: connections.accountId, set: values })
          .run();

        const connection = tx
          .select(columns)
          .from(connections)
          .innerJoin(tokens, eq(tokens.hash, connections.tokenHash))
          .where(eq(connections.accountId, accountId))
          .get();

        if (!connection) throw new Error("The connection went missing");

        return connection;
      });
    },

    // Says whether the client is still the account's connection, and notes that it listens and
    // what it heard.
    checkIn: ({ accountId, id, cursor }: CheckInOptions) =>
      db
        .update(connections)
        .set({ listenedAt: new Date(), startsAfter: cursor })
        .where(and(eq(connections.accountId, accountId), eq(connections.id, id)))
        .returning({ id: connections.id })
        .all().length > 0,

    isListening: (accountId: string) =>
      Boolean(
        db
          .select({ id: connections.id })
          .from(connections)
          .where(
            and(
              eq(connections.accountId, accountId),
              gt(connections.listenedAt, new Date(Date.now() - listenWindow)),
            ),
          )
          .get(),
      ),
  };
}

export type ConnectionsRepository = ReturnType<typeof createConnectionsRepository>;
