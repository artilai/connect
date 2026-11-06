import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import type { AgentEnv } from "../agents/env";
import { channelKindSchema } from "../channels/kinds";
import { jsonResponse } from "../http/openapi";
import type { AddressesRepository } from "./repository";

const addressSchema = z
  .object({
    id: z.uuid(),
    channel: channelKindSchema,
    value: z.string().describe("The address on the channel, like a Telegram bot's @username"),
    domainId: z.uuid().nullable().describe("Null: the server has no domains of its own"),
    primary: z.boolean().describe("Whether new messages on its channel go out from it"),
    createdAt: z.date(),
  })
  .meta({ id: "Address" });

type Address = z.infer<typeof addressSchema>;

const docs = {
  list: describeRoute({
    tags: ["Addresses"],
    operationId: "listAddresses",
    summary: "List addresses",
    description: "List an agent's Telegram bots.",
    responses: { 200: jsonResponse("The addresses", z.array(addressSchema)) },
  }),
};

type CreateAddressRoutesOptions = { addresses: AddressesRepository };

export function createAddressRoutes({ addresses }: CreateAddressRoutesOptions) {
  return new Hono<AgentEnv>().get("/", docs.list, (c) =>
    c.json(
      addresses.listByAgent(c.var.agent.id).map(({ id, channel, value, createdAt }): Address => ({
        id,
        channel,
        value,
        domainId: null,
        primary: true,
        createdAt,
      })),
    ),
  );
}
