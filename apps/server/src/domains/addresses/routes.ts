import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { jsonResponse } from "../../platform/http/openapi";
import type { AgentEnv } from "../agents/schema";
import { addressSchema, toAddress } from "./schema";
import type { AddressesService } from "./service";

const docs = {
  list: describeRoute({
    tags: ["Addresses"],
    operationId: "listAddresses",
    summary: "List addresses",
    description: "List the addresses an agent has on the server's channels.",
    responses: { 200: jsonResponse("The addresses", z.array(addressSchema)) },
  }),
};

type CreateAddressRoutesOptions = { addresses: AddressesService };

export function createAddressRoutes({ addresses }: CreateAddressRoutesOptions) {
  return new Hono<AgentEnv>().get("/", docs.list, (c) =>
    c.json(addresses.listByAgent(c.var.agent.id).map(toAddress)),
  );
}
