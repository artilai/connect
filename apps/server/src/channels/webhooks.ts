import { Hono } from "hono";

import type { Channel } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import type { AddressesRepository } from "../addresses/repository";
import type { Receive } from "../messages/inbound";
import { type ArrivalKind, channelKinds } from "./kinds";
import { receiveEvents } from "./receivers";

type CreateChannelWebhooksOptions = {
  channels: ReadonlyMap<ArrivalKind, Channel<ArrivalKind>>;
  addresses: AddressesRepository;
  receive: Receive;
};

// Where a channel's provider posts what reaches its addresses, at /api/channels/<kind>.
export function createChannelWebhooks({
  channels,
  addresses,
  receive,
}: CreateChannelWebhooksOptions) {
  return new Hono().post("/:kind", (c) => {
    const kind = channelKinds.find((known) => known === c.req.param("kind"));
    const channel = kind && channels.get(kind);

    if (!kind || !channel?.handleWebhook) {
      throw new AppError({ code: "not_found", message: "This channel takes no webhooks" });
    }

    return channel.handleWebhook(c.req.raw, {
      credentialsOf: async (value) =>
        addresses.findByValue({ channel: kind, value })?.credentials ?? null,
      receive: (events) => receiveEvents({ receive, channel: kind, events }),
    });
  });
}
