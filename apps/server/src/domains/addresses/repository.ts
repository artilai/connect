import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { addresses, accounts } from "../../platform/db/schema";
import type { ChannelKind } from "../channels/schema";
import { isConnected } from "./schema";

type ConnectOptions = {
  accountId: string;
  channel: ChannelKind;
  value: string;
  token: string;
};

type FindByValueOptions = { channel: ChannelKind; value: string };

type FindByAccountOptions = { accountId: string; channel: ChannelKind };

type FindOrAddOptions = { accountId: string; channel: ChannelKind; value: string };

const connectedWhere = isNotNull(addresses.token);

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

  function findByAccount({ accountId, channel }: FindByAccountOptions) {
    return db
      .select()
      .from(addresses)
      .where(
        and(eq(addresses.accountId, accountId), eq(addresses.channel, channel), connectedWhere),
      )
      .all()
      .find(isConnected);
  }

  return {
    findByValue,

    findByAccount,

    // The account that holds the address now, if one does.
    findHolder: ({ channel, value }: FindByValueOptions) =>
      db
        .select({ accountId: addresses.accountId, name: accounts.name })
        .from(addresses)
        .innerJoin(accounts, eq(accounts.id, addresses.accountId))
        .where(and(eq(addresses.channel, channel), eq(addresses.value, value), connectedWhere))
        .get(),

    // Gives the account the address in place of its other one on the channel, which it lets go of;
    // a row the account held before comes back, and a new one keeps another account's messages
    // apart.
    connect({ accountId, channel, value, token }: ConnectOptions) {
      return db.transaction((tx) => {
        const replaced = tx
          .select()
          .from(addresses)
          .where(
            and(
              eq(addresses.accountId, accountId),
              eq(addresses.channel, channel),
              ne(addresses.value, value),
              connectedWhere,
            ),
          )
          .all()
          .filter(isConnected);

        if (replaced.length > 0) {
          tx.update(addresses)
            .set({ token: null })
            .where(
              inArray(
                addresses.id,
                replaced.map(({ id }) => id),
              ),
            )
            .run();
        }

        const accountAddressWhere = and(
          eq(addresses.accountId, accountId),
          eq(addresses.channel, channel),
          eq(addresses.value, value),
        );

        const address =
          tx.update(addresses).set({ token }).where(accountAddressWhere).returning().get() ??
          tx.insert(addresses).values({ accountId, channel, value, token }).returning().get();

        return { address, replaced };
      });
    },

    // An address the server gives the account by itself, like its Message URL, which takes no token;
    // the first time the server needs it adds it.
    findOrAdd: ({ accountId, channel, value }: FindOrAddOptions) =>
      db
        .select()
        .from(addresses)
        .where(
          and(
            eq(addresses.accountId, accountId),
            eq(addresses.channel, channel),
            eq(addresses.value, value),
          ),
        )
        .get() ?? db.insert(addresses).values({ accountId, channel, value }).returning().get(),

    // Keeps the address and its messages, without the token that lets it send.
    disconnect(options: FindByAccountOptions) {
      const address = findByAccount(options);

      if (!address) return undefined;

      db.update(addresses).set({ token: null }).where(eq(addresses.id, address.id)).run();

      return address;
    },

    listByAccount: (accountId: string) =>
      db
        .select()
        .from(addresses)
        .where(and(eq(addresses.accountId, accountId), connectedWhere))
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
