import { z } from "zod";

import { type admissions, admits, type refusals } from "../../platform/db/schema";

export type Refusal = (typeof refusals)[number];

export type Admission = (typeof admissions)[number];

export const admitSchema = z.enum(admits);

export type Admit = z.infer<typeof admitSchema>;

export type Access = { admit: Admit; senders: string[] };

export const defaultAccess: Access = { admit: "team", senders: [] };

const refusalReasons = new Map<string, string>(
  Object.entries({
    self: "it came from the account itself",
    spam: "it was marked as spam",
    sender: "the sender is not on its list",
    outsider: "the sender is not on its team",
    unverified: "the channel could not confirm who sent it",
  } satisfies Record<Refusal, string>),
);

export function describeRefusal(refusal: string) {
  return `Did not wake the agents: ${refusalReasons.get(refusal) ?? refusal}.`;
}
