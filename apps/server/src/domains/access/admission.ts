import type { Access, Admission, Refusal } from "./schema";

export type Arrival = {
  fromSelf: boolean;
  spam: boolean;
  access: Access;
  from: string;
  // Another address the sender goes by on the channel, which the list can name in place of from.
  handle: string | null;
  // The group the message came in, which the list can name to let in everyone in it.
  group: string | null;
  fromTeam: boolean;
  fromVerified: boolean;
};

export function admit(arrival: Arrival): Refusal | null {
  if (arrival.fromSelf) return "self";

  if (arrival.spam) return "spam";

  // Listed senders wake the agent whether the whole team does too or only they do.
  const listed = isListed(arrival);

  if (arrival.access.admit === "list" && !listed) return "sender";

  if (arrival.access.admit === "team" && !arrival.fromTeam && !listed) return "outsider";

  if (arrival.access.admit !== "anyone" && !arrival.fromVerified) return "unverified";

  return null;
}

// Who the sender of a message that woke the agent is to it. A sender who could not be verified
// counts as anyone, whatever address they claim.
export function admissionOf(arrival: Arrival): Admission {
  if (!arrival.fromVerified) return "anyone";

  if (arrival.fromTeam) return "team";

  return isListed(arrival) ? "listed" : "anyone";
}

function isListed({ access, from, handle, group }: Arrival) {
  return access.senders.some((sender) => sender === from || sender === handle || sender === group);
}
