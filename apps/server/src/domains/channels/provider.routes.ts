import { Hono } from "hono";

import { AppError } from "@artil/errors";

import type { AddressesService } from "../addresses/service";
import type { Receive } from "../messages/service";
import { receiveEvents } from "./receivers";
import type { ChannelsService } from "./service";

type CreateProviderRoutesOptions = {
  channels: ChannelsService;
  addresses: AddressesService;
  receive: Receive;
};

// Where a channel's provider posts what reaches its addresses, at /api/channels/<kind>.
export function createProviderRoutes({
  channels,
  addresses,
  receive,
}: CreateProviderRoutesOptions) {
  return new Hono().post("/:kind", (c) => {
    const kind = c.req.param("kind");
    const channel = channels.find(kind);

    if (!channel?.handleWebhook) {
      throw new AppError({ code: "not_found", message: "This channel takes no webhooks" });
    }

    return channel.handleWebhook(c.req.raw, {
      webhookSecret: channels.webhookSecretOf(kind),
      tokenOf: async (value) => addresses.findByValue({ channel: kind, value })?.token ?? null,
      receive: (events) => receiveEvents({ receive, channel: kind, events }),
    });
  });
}
