import type { Channel, ChannelEvent } from "@artil/channels/contract";
import { messageOf } from "@artil/errors";

import type { AddressesRepository, ConnectedAddress } from "../addresses/repository";
import type { Receive } from "../messages/inbound";
import type { ChannelKind } from "./kinds";

type ReceiveEventsOptions = { receive: Receive; channel: ChannelKind; events: ChannelEvent[] };

// Takes what a channel handed over: each message that reached one of its addresses.
export async function receiveEvents({ receive, channel, events }: ReceiveEventsOptions) {
  for (const event of events) {
    if (event.type === "message.received") await receive({ channel, message: event.message });
  }
}

type CreateReceiversOptions = {
  channel: Channel<ChannelKind>;
  addresses: AddressesRepository;
  receive: Receive;
  log: (line: string) => void;
};

type RunningReceiver = { credentials: string; controller: AbortController };

// Starts the channel on each address connected to it, as the addresses the database holds change;
// the channel chooses how their messages come.
export function createReceivers({ channel, addresses, receive, log }: CreateReceiversOptions) {
  const runningReceivers = new Map<string, RunningReceiver>();

  function startReceiver({ id, value, credentials }: ConnectedAddress) {
    const controller = new AbortController();

    runningReceivers.set(id, { credentials, controller });

    void channel.start?.({
      credentials,
      signal: controller.signal,
      receive: (events) => receiveEvents({ receive, channel: channel.kind, events }),
      onError: (cause) => log(`${value} on ${channel.kind}: ${messageOf(cause, String(cause))}`),
    });
  }

  return {
    sync() {
      const connectedAddresses = addresses.listConnected(channel.kind);

      for (const [id, { credentials, controller }] of runningReceivers) {
        const stillConnected = connectedAddresses.some(
          (address) => address.id === id && address.credentials === credentials,
        );

        if (!stillConnected) {
          controller.abort();
          runningReceivers.delete(id);
        }
      }

      for (const address of connectedAddresses) {
        if (!runningReceivers.has(address.id)) startReceiver(address);
      }
    },

    stop() {
      for (const { controller } of runningReceivers.values()) controller.abort();

      runningReceivers.clear();
    },
  };
}
