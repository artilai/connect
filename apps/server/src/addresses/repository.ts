import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";

import { AppError } from "@artil/errors";

import type { ChannelKind } from "../channels/kinds";
import type { Database } from "../db/connection";
import { addresses, agents } from "../db/schema";

type AddressRecord = typeof addresses.$inferSelect;

export type ConnectedAddress = AddressRecord & { credentials: string };

type ConnectOptions = { agentId: string; channel: ChannelKind; value: string; credentials: string };

type FindByValueOptions = { channel: ChannelKind; value: string };

type FindByAgentOptions = { agentId: string; channel: ChannelKind };

function isConnected(address: AddressRecord): address is ConnectedAddress {
  return address.credentials !== null;
}

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

    // An agent holds one address on a channel, so a new one takes the place of the old. A bot
    // another agent let go of gets a row of its own, so the messages it brought stay with that one.
    connect({ agentId, channel, value, credentials }: ConnectOptions) {
      return db.transaction((tx) => {
        const holder = tx
          .select({ agentId: addresses.agentId, name: agents.name })
          .from(addresses)
          .innerJoin(agents, eq(agents.id, addresses.agentId))
          .where(and(eq(addresses.channel, channel), eq(addresses.value, value), connectedWhere))
          .get();

        if (holder && holder.agentId !== agentId) {
          throw new AppError({ code: "conflict", message: `${value} belongs to ${holder.name}` });
        }

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
