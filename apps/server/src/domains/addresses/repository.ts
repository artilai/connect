import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { addresses, agents } from "../../platform/db/schema";
import type { ChannelKind } from "../channels/schema";
import { isConnected } from "./schema";

type ConnectOptions = { agentId: string; channel: ChannelKind; value: string; credentials: string };

type FindByValueOptions = { channel: ChannelKind; value: string };

type FindByAgentOptions = { agentId: string; channel: ChannelKind };

type FindOrAddOptions = { agentId: string; channel: ChannelKind; value: string };

const connectedWhere = isNotNull(addresses.credentials);

// Each lookup finds connected addresses only; a disconnected one stays only for its messages.
export function createAddressesRepository(db: Database) {
  function findByValue({ channel, value }: FindByValueOptions) {
    return db
      .select()
      .from(addresses)
      .where(and(eq(addresses.channel, channel), eq(addresses.value, value), connectedWhere))
      .all()
      .find(isConnected);
  }

  function findByAgent({ agentId, channel }: FindByAgentOptions) {
    return db
      .select()
      .from(addresses)
      .where(and(eq(addresses.agentId, agentId), eq(addresses.channel, channel), connectedWhere))
      .all()
      .find(isConnected);
  }

  return {
    findByValue,

    findByAgent,

    // The agent that holds the address now, if one does.
    findHolder: ({ channel, value }: FindByValueOptions) =>
      db
        .select({ agentId: addresses.agentId, name: agents.name })
        .from(addresses)
        .innerJoin(agents, eq(agents.id, addresses.agentId))
        .where(and(eq(addresses.channel, channel), eq(addresses.value, value), connectedWhere))
        .get(),

    // Gives the agent the address in place of its other one on the channel, which it lets go of; a
    // row the agent held before comes back, and a new one keeps another agent's messages apart.
    connect({ agentId, channel, value, credentials }: ConnectOptions) {
      return db.transaction((tx) => {
        const replaced = tx
          .select()
          .from(addresses)
          .where(
            and(
              eq(addresses.agentId, agentId),
              eq(addresses.channel, channel),
              ne(addresses.value, value),
              connectedWhere,
            ),
          )
          .all()
          .filter(isConnected);

        if (replaced.length > 0) {
          tx.update(addresses)
            .set({ credentials: null })
            .where(
              inArray(
                addresses.id,
                replaced.map(({ id }) => id),
              ),
            )
            .run();
        }

        const agentAddressWhere = and(
          eq(addresses.agentId, agentId),
          eq(addresses.channel, channel),
          eq(addresses.value, value),
        );

        const address =
          tx.update(addresses).set({ credentials }).where(agentAddressWhere).returning().get() ??
          tx.insert(addresses).values({ agentId, channel, value, credentials }).returning().get();

        return { address, replaced };
      });
    },

    // An address the server gives the agent by itself, like its Message URL, which takes no
    // credentials and is there only for its messages; the first message adds it.
    findOrAdd: ({ agentId, channel, value }: FindOrAddOptions) =>
      db
        .select()
        .from(addresses)
        .where(
          and(
            eq(addresses.agentId, agentId),
            eq(addresses.channel, channel),
            eq(addresses.value, value),
          ),
        )
        .get() ?? db.insert(addresses).values({ agentId, channel, value }).returning().get(),

    // Keeps the address and its messages, without the credentials that let it send.
    disconnect(options: FindByAgentOptions) {
      const address = findByAgent(options);

      if (!address) return undefined;

      db.update(addresses).set({ credentials: null }).where(eq(addresses.id, address.id)).run();

      return address;
    },

    listByAgent: (agentId: string) =>
      db
        .select()
        .from(addresses)
        .where(and(eq(addresses.agentId, agentId), connectedWhere))
        .orderBy(asc(addresses.createdAt))
        .all()
        .filter(isConnected),

    listConnected: (channel: ChannelKind) =>
      db
        .select()
        .from(addresses)
        .where(and(eq(addresses.channel, channel), connectedWhere))
        .all()
        .filter(isConnected),
  };
}

export type AddressesRepository = ReturnType<typeof createAddressesRepository>;
