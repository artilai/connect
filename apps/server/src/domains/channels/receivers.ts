import type { Channel, ChannelEvent } from "@artil/channels/contract";
import { messageOf } from "@artil/errors";
import { abortableSleep, minute, second } from "@artil/utils/time";

import type { ConnectedAddress } from "../addresses/schema";
import type { AddressesService } from "../addresses/service";
import type { Receive } from "../messages/service";
import type { ChannelKind } from "./schema";

type ReceiveEventsOptions = { receive: Receive; channel: ChannelKind; events: ChannelEvent[] };

// Takes what a channel handed over: each message that reached one of its addresses.
export async function receiveEvents({ receive, channel, events }: ReceiveEventsOptions) {
  for (const event of events) {
    if (event.type === "message.received") await receive({ channel, message: event.message });
  }
}

// A channel that fails to start on an address starts again after a while, and longer each time.
const firstRetryDelay = second;

const longestRetryDelay = minute;

type CreateReceiversOptions = {
  channel: Channel;
  // Where the channel's provider posts, which a channel on a server nothing can reach goes without.
  webhookUrl: string | undefined;
  webhookSecret: string;
  addresses: AddressesService;
  receive: Receive;
  log: (line: string) => void;
  // Waits before starting the channel again; tests make it instant.
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

type RunningReceiver = { token: string; controller: AbortController };

// Starts the channel on each address connected to it, as the addresses the database holds change;
// the channel chooses how their messages come.
export function createReceivers({
  channel,
  webhookUrl,
  webhookSecret,
  addresses,
  receive,
  log,
  sleep = abortableSleep,
}: CreateReceiversOptions) {
  const runningReceivers = new Map<string, RunningReceiver>();

  // Keeps the channel started on the address until the signal aborts. A start that fails is tried
  // again, so a channel that gives up on an error comes back; one that returns is done, like a
  // channel whose provider posts to the webhook from then on.
  async function run({ value, token }: ConnectedAddress, signal: AbortSignal) {
    let retryDelay = firstRetryDelay;

    while (!signal.aborted) {
      const startedAt = Date.now();

      try {
        await channel.start({
          token,
          ...(webhookUrl && { webhookUrl }),
          webhookSecret,
          signal,
          receive: (events) => receiveEvents({ receive, channel: channel.kind, events }),
        });

        return;
      } catch (cause) {
        if (signal.aborted) return;

        log(`${value} on ${channel.kind}: ${messageOf(cause, String(cause))}`);

        // A start that ran a while before it failed was well, so the waits begin again.
        if (Date.now() - startedAt > longestRetryDelay) retryDelay = firstRetryDelay;

        await sleep(retryDelay, signal);
        retryDelay = Math.min(retryDelay * 2, longestRetryDelay);
      }
    }
  }

  function startReceiver(address: ConnectedAddress) {
    const controller = new AbortController();

    runningReceivers.set(address.id, { token: address.token, controller });
    void run(address, controller.signal);
  }

  return {
    sync() {
      const connectedAddresses = addresses.listConnected(channel.kind);

      for (const [id, { token, controller }] of runningReceivers) {
        const stillConnected = connectedAddresses.some(
          (address) => address.id === id && address.token === token,
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
