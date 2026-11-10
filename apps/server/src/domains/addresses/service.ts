import type { Channel } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import type { AddressesRepository } from "./repository";
import { toChannelAddress } from "./schema";

type CreateAddressesServiceOptions = {
  addressesRepository: AddressesRepository;
  channels: ChannelsService;
};

type ConnectOptions = { agentId: string; kind: ChannelKind; credentials: string };

type DisconnectOptions = { agentId: string; kind: ChannelKind };

// A channel without credentials to connect with, like the Message URL, has its addresses by itself.
function nothingToConnect(channel: Channel) {
  return new AppError({
    code: "invalid_input",
    message: `Every agent has its ${channel.name} already; there is nothing to connect`,
  });
}

export function createAddressesService({
  addressesRepository,
  channels,
}: CreateAddressesServiceOptions) {
  return {
    findByValue: addressesRepository.findByValue,
    findByAgent: addressesRepository.findByAgent,
    listByAgent: addressesRepository.listByAgent,
    listConnected: addressesRepository.listConnected,

    // A channel a person connects an address of, by the credentials it asks for.
    getConnectable(kind: ChannelKind) {
      const channel = channels.get(kind);

      if (!channel.connect) throw nothingToConnect(channel);

      return channel;
    },

    // Connects an address of the channel to the agent with the credentials the channel asks for.
    // One agent at a time holds an address, and the agent's other address on the channel goes.
    async connect({ agentId, kind, credentials: given }: ConnectOptions) {
      const channel = channels.get(kind);

      if (!channel.connect) throw nothingToConnect(channel);

      const { address: value, credentials } = await channel.connect(given);
      const holder = addressesRepository.findHolder({ channel: kind, value });

      if (holder && holder.agentId !== agentId) {
        throw new AppError({ code: "conflict", message: `${value} belongs to ${holder.name}` });
      }

      const connected = addressesRepository.connect({ agentId, channel: kind, value, credentials });

      for (const old of connected.replaced) await channel.disconnect(toChannelAddress(old));

      return { ...connected, channel };
    },

    // Keeps the address and its messages, without the credentials that let it send.
    async disconnect({ agentId, kind }: DisconnectOptions) {
      const channel = channels.get(kind);
      const address = addressesRepository.disconnect({ agentId, channel: kind });

      if (address) await channel.disconnect(toChannelAddress(address));

      return { address, channel };
    },
  };
}

export type AddressesService = ReturnType<typeof createAddressesService>;
