import type { Access, Admission, Refusal } from "./schema";

export type Limits = { wakesPerHour: number; sendsPerHour: number };

export const defaultLimits: Limits = { wakesPerHour: 100, sendsPerHour: 100 };

export type Arrival = {
  fromSelf: boolean;
  spam: boolean;
  access: Access;
  from: string;
  // Another address the sender goes by on the channel, which the list can name in place of from.
  handle: string | null;
  fromTeam: boolean;
  fromVerified: boolean;
  wakesInLastHour: number;
};

export function admit(arrival: Arrival, limits: Limits): Refusal | null {
  if (arrival.fromSelf) return "self";

  if (arrival.spam) return "spam";

  // Listed senders wake the agent whether the whole team does too or only they do.
  const listed = isListed(arrival);

  if (arrival.access.admit === "list" && !listed) return "sender";

  if (arrival.access.admit === "team" && !arrival.fromTeam && !listed) return "outsider";

  if (arrival.access.admit !== "anyone" && !arrival.fromVerified) return "unverified";

  if (arrival.wakesInLastHour >= limits.wakesPerHour) return "rate_limit";

  return null;
}

// Who the sender of a message that woke the agent is to it. A sender who could not be verified
// counts as anyone, whatever address they claim.
export function admissionOf(arrival: Arrival): Admission {
  if (!arrival.fromVerified) return "anyone";

  if (arrival.fromTeam) return "team";

  return isListed(arrival) ? "listed" : "anyone";
}

function isListed({ access, from, handle }: Arrival) {
  return access.senders.some((sender) => sender === from || sender === handle);
}
