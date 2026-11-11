import { AppError } from "@artil/errors";

import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import type { AddressesRepository } from "./repository";

type CreateAddressesServiceOptions = {
  addressesRepository: AddressesRepository;
  channels: ChannelsService;
};

type ConnectOptions = { agentId: string; kind: ChannelKind; credentials: string };

type DisconnectOptions = { agentId: string; kind: ChannelKind };

export function createAddressesService({
  addressesRepository,
  channels,
}: CreateAddressesServiceOptions) {
  return {
    findByValue: addressesRepository.findByValue,
    findByAgent: addressesRepository.findByAgent,
    findOrAdd: addressesRepository.findOrAdd,
    listByAgent: addressesRepository.listByAgent,
    listConnected: addressesRepository.listConnected,

    // Connects an address of the channel to the agent with the credentials the channel asks for.
    // One agent at a time holds an address, and the agent's other address on the channel goes.
    async connect({ agentId, kind, credentials: given }: ConnectOptions) {
      const channel = channels.get(kind);

      if (!channel.connect) {
        throw new AppError({
          code: "invalid_input",
          message: `Every agent has its ${channel.name} already; there is nothing to connect`,
        });
      }

      const { value, credentials } = await channel.connect(given);
      const holder = addressesRepository.findHolder({ channel: kind, value });

      if (holder && holder.agentId !== agentId) {
        throw new AppError({ code: "conflict", message: `${value} belongs to ${holder.name}` });
      }

      const connected = addressesRepository.connect({ agentId, channel: kind, value, credentials });

      for (const old of connected.replaced) await channel.disconnect(old);

      return { ...connected, channel };
    },

    // Keeps the address and its messages, without the credentials that let it send.
    async disconnect({ agentId, kind }: DisconnectOptions) {
      const channel = channels.get(kind);
      const address = addressesRepository.disconnect({ agentId, channel: kind });

      if (address) await channel.disconnect(address);

      return { address, channel };
    },
  };
}

export type AddressesService = ReturnType<typeof createAddressesService>;
