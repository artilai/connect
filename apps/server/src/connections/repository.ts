import { and, eq, gt } from "drizzle-orm";

import { second } from "@artil/utils/time";

import type { Database } from "../db/connection";
import { connections, tokens } from "../db/schema";

// A client listens while its stream checked in lately, as one does every 30 seconds.
const listenWindow = 90 * second;

export type ConnectionRecord = {
  id: string;
  tokenId: string;
  client: string;
  machine: string | null;
  startsAfter: number;
};

type ConnectOptions = {
  agentId: string;
  tokenHash: string;
  client: string;
  machine: string | null;
  // The agent's last event, after which a client that is new to it starts.
  lastEventId: number;
};

type CheckInOptions = {
  agentId: string;
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
  function findByAgent(agentId: string): ConnectionRecord | undefined {
    return db
      .select(columns)
      .from(connections)
      .innerJoin(tokens, eq(tokens.hash, connections.tokenHash))
      .where(eq(connections.agentId, agentId))
      .get();
  }

  return {
    findByAgent,

    // Connects a client in place of any other. The same client coming back resumes where it left
    // off; another starts from now.
    connect({ agentId, tokenHash, client, machine, lastEventId }: ConnectOptions) {
      return db.transaction((tx) => {
        const current = tx.select().from(connections).where(eq(connections.agentId, agentId)).get();

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
          .values({ agentId, ...values })
          .onConflictDoUpdate({ target: connections.agentId, set: values })
          .run();

        const connection = tx
          .select(columns)
          .from(connections)
          .innerJoin(tokens, eq(tokens.hash, connections.tokenHash))
          .where(eq(connections.agentId, agentId))
          .get();

        if (!connection) throw new Error("The connection went missing");

        return connection;
      });
    },

    // Says whether the client is still the agent's connection, and notes that it listens and
    // what it heard.
    checkIn: ({ agentId, id, cursor }: CheckInOptions) =>
      db
        .update(connections)
        .set({ listenedAt: new Date(), startsAfter: cursor })
        .where(and(eq(connections.agentId, agentId), eq(connections.id, id)))
        .returning({ id: connections.id })
        .all().length > 0,

    isListening: (agentId: string) =>
      db
        .select({ id: connections.id })
        .from(connections)
        .where(
          and(
            eq(connections.agentId, agentId),
            gt(connections.listenedAt, new Date(Date.now() - listenWindow)),
          ),
        )
        .get() !== undefined,
  };
}

export type ConnectionsRepository = ReturnType<typeof createConnectionsRepository>;
