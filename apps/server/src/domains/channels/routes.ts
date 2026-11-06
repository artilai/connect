import { Hono } from "hono";

import { AppError } from "@artil/errors";

import type { AddressesService } from "../addresses/service";
import type { Receive } from "../messages/service";
import { receiveEvents } from "./receivers";
import type { ChannelsService } from "./service";

type CreateChannelRoutesOptions = {
  channels: ChannelsService;
  addresses: AddressesService;
  receive: Receive;
};

// Where a channel's provider posts what reaches its addresses, at /api/channels/<kind>.
export function createChannelRoutes({ channels, addresses, receive }: CreateChannelRoutesOptions) {
  return new Hono().post("/:kind", (c) => {
    const kind = c.req.param("kind");
    const channel = channels.find(kind);

    if (!channel?.handleWebhook) {
      throw new AppError({ code: "not_found", message: "This channel takes no webhooks" });
    }

    return channel.handleWebhook(c.req.raw, {
      credentialsOf: async (value) =>
        addresses.findByValue({ channel: kind, value })?.credentials ?? null,
      receive: (events) => receiveEvents({ receive, channel: kind, events }),
    });
  });
}
