import { z } from "zod";

import type { addresses } from "../../platform/db/schema";
import { channelKindSchema } from "../channels/schema";

export type AddressRecord = typeof addresses.$inferSelect;

export type ConnectedAddress = AddressRecord & { credentials: string };

export function isConnected(address: AddressRecord): address is ConnectedAddress {
  return address.credentials !== null;
}

export const addressSchema = z
  .object({
    id: z.uuid(),
    channel: channelKindSchema,
    value: z.string().describe("The agent's address on the channel"),
    domainId: z.uuid().nullable().describe("Null: the server has no domains of its own"),
    primary: z.boolean().describe("Whether new messages on its channel go out from it"),
    createdAt: z.date(),
  })
  .meta({ id: "Address" });

type Address = z.infer<typeof addressSchema>;

export function toAddress({ id, channel, value, createdAt }: AddressRecord): Address {
  return { id, channel, value, domainId: null, primary: true, createdAt };
}
