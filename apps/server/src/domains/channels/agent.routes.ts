import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { jsonResponse } from "../../platform/http/openapi";
import type { AccountEnv } from "../accounts/schema";
import { channelSchema, toChannel } from "./schema";
import type { ChannelsService } from "./service";

const docs = {
  list: describeRoute({
    tags: ["Channels"],
    operationId: "listChannels",
    summary: "List channels",
    description:
      "List the channels the server has, with the words a client builds its texts about each from, and the most a message on each carries.",
    responses: { 200: jsonResponse("The channels", z.array(channelSchema)) },
  }),
};

type CreateChannelRoutesOptions = { channels: ChannelsService };

// The server's channels as a client reads them, at /api/agents/<id>/channels.
export function createChannelRoutes({ channels }: CreateChannelRoutesOptions) {
  return new Hono<AccountEnv>().get("/", docs.list, (c) => c.json(channels.list().map(toChannel)));
}
