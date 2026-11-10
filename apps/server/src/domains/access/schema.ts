import type { admissions, admits, refusals } from "../../platform/db/schema";

export type Refusal = (typeof refusals)[number];

export type Admission = (typeof admissions)[number];

export type Admit = (typeof admits)[number];

// Who besides the list may wake the agent, named by a word of their own: anyone, or the team of the
// server's agents.
export const groups = ["anyone", "team"] as const;

export type Group = (typeof groups)[number];

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
