import type { Channel } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import type { AddressesRepository } from "./repository";

type CreateAddressesServiceOptions = {
  addressesRepository: AddressesRepository;
  channels: ChannelsService;
};

type ConnectOptions = { accountId: string; kind: ChannelKind; token: string };

type DisconnectOptions = { accountId: string; kind: ChannelKind };

// A channel without a token to connect with, like the Message URL, has its addresses by itself.
function nothingToConnect(channel: Channel) {
  return new AppError({
    code: "invalid_input",
    message: `Every account has its ${channel.name} already; there is nothing to connect`,
  });
}

export function createAddressesService({
  addressesRepository,
  channels,
}: CreateAddressesServiceOptions) {
  return {
    findByValue: addressesRepository.findByValue,
    findByAccount: addressesRepository.findByAccount,
    findOrAdd: addressesRepository.findOrAdd,
    listByAccount: addressesRepository.listByAccount,
    listConnected: addressesRepository.listConnected,

    // A channel a person connects an address of, by the token it asks for.
    getConnectable(kind: ChannelKind) {
      const channel = channels.get(kind);

      if (!channel.connect) throw nothingToConnect(channel);

      return channel;
    },

    // Connects an address of the channel to the account with the token the channel asks for. One
    // account at a time holds an address, and the account's other address on the channel goes.
    async connect({ accountId, kind, token }: ConnectOptions) {
      const channel = channels.get(kind);

      if (!channel.connect) throw nothingToConnect(channel);

      const value = await channel.connect(token);
      const holder = addressesRepository.findHolder({ channel: kind, value });

      if (holder && holder.accountId !== accountId) {
        throw new AppError({ code: "conflict", message: `${value} belongs to ${holder.name}` });
      }

      const connected = addressesRepository.connect({
        accountId,
        channel: kind,
        value,
        token,
      });

      for (const old of connected.replaced) await channel.disconnect(old.token);

      return { ...connected, channel };
    },

    // Keeps the address and its messages, without the token that lets it send.
    async disconnect({ accountId, kind }: DisconnectOptions) {
      const channel = channels.get(kind);
      const address = addressesRepository.disconnect({ accountId, channel: kind });

      if (address) await channel.disconnect(address.token);

      return { address, channel };
    },
  };
}

export type AddressesService = ReturnType<typeof createAddressesService>;
