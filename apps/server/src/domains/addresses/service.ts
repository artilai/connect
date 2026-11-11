import type { Channel } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import type { AccountsService } from "../accounts/service";
import type { ChannelKind } from "../channels/schema";
import type { ChannelsService } from "../channels/service";
import type { AddressesRepository } from "./repository";

type CreateAddressesServiceOptions = {
  addressesRepository: AddressesRepository;
  accounts: AccountsService;
  channels: ChannelsService;
};

type FindByAccountOptions = { accountId: string; channel: ChannelKind };

type FindByValueOptions = { channel: ChannelKind; value: string };

type ReadAddressOptions = {
  channel: Channel;
  input: string;
  parse: (input: string) => string | null;
};

type ReadRecipientsOptions = { channel: Channel; to: readonly string[] };

type ReadSenderOptions = { channel: Channel; input: string };

type ConnectOptions = { accountId: string; kind: ChannelKind; token: string };

type DisconnectOptions = { accountId: string; kind: ChannelKind };

function invalid(message: string) {
  return new AppError({ code: "invalid_input", message });
}

// A channel without a token to connect with, like the Message URL, has its addresses by itself.
function nothingToConnect(channel: Channel) {
  return invalid(
    `Every account has its ${channel.name} already; there is nothing to connect or disconnect`,
  );
}

export function createAddressesService({
  addressesRepository,
  accounts,
  channels,
}: CreateAddressesServiceOptions) {
  // The account's address on the channel. A channel that connects none, like the Message URL, gives
  // every account one by itself: its id, which comes the first time the server needs it.
  function findByAccount({ accountId, channel }: FindByAccountOptions) {
    return channels.get(channel).connect
      ? addressesRepository.findByAccount({ accountId, channel })
      : addressesRepository.findOrAdd({ accountId, channel, value: accountId });
  }

  // The address with the value on the channel, of whichever account holds it.
  function findByValue({ channel, value }: FindByValueOptions) {
    if (channels.get(channel).connect) return addressesRepository.findByValue({ channel, value });

    const account = accounts.findById(value);

    return account ? findByAccount({ accountId: account.id, channel }) : undefined;
  }

  // The address a person means on the channel: one of the server's accounts, by its name or id,
  // stands for its address there, and anyone else is as the channel reads them. Only the server's
  // accounts are on a channel that connects no address.
  function readAddress({ channel, input, parse }: ReadAddressOptions) {
    const account = accounts.findByIdOrName(input);

    if (!account) return channel.connect ? parse(input) : null;

    const address = findByAccount({ accountId: account.id, channel: channel.kind });

    if (!address) throw invalid(`${account.name} has no ${channel.name} ${channel.labels.address}`);

    return address.value;
  }

  return {
    findByAccount,
    findByValue,
    listByAccount: addressesRepository.listByAccount,
    listConnected: addressesRepository.listConnected,

    // Whom a message goes to, as the channel writes them.
    readRecipients({ channel, to }: ReadRecipientsOptions) {
      const { name, labels, limits } = channel;

      if (to.length > limits.recipients) {
        throw invalid(
          limits.recipients === 1
            ? `A ${name} message goes to one recipient`
            : `A ${name} message goes to at most ${limits.recipients} recipients`,
        );
      }

      return to.map((input) => {
        const recipient = readAddress({
          channel,
          input,
          parse: (written) => channel.parseRecipient(written),
        });

        if (!recipient) throw invalid(`${input} is not a ${name} ${labels.contact}`);

        return recipient;
      });
    },

    // A sender as the channel writes them in from, which a list names.
    readSender({ channel, input }: ReadSenderOptions) {
      const sender = readAddress({
        channel,
        input,
        parse: (written) => channel.parseSender(written),
      });

      if (!sender) throw invalid(`${input} is not a ${channel.name} ${channel.labels.contact}`);

      return sender;
    },

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
