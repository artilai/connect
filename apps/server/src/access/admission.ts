export type Limits = { wakesPerHour: number; sendsPerHour: number };

export const defaultLimits: Limits = { wakesPerHour: 100, sendsPerHour: 100 };

export const refusals = [
  "self",
  "spam",
  "plan_limit",
  "rate_limit",
  "sender",
  "outsider",
  "unverified",
] as const;

export type Refusal = (typeof refusals)[number];

const refusalReasons = new Map<string, string>(
  Object.entries({
    self: "it came from the account itself",
    spam: "it was marked as spam",
    plan_limit: "the plan's monthly limit was reached",
    rate_limit: "the hourly limit was reached",
    sender: "the sender is not on its list",
    outsider: "the sender is not on its team",
    unverified: "the channel could not confirm who sent it",
  } satisfies Record<Refusal, string>),
);

const refusalLabel = "Did not wake the agents";

export function describeRefusal(refusal: string) {
  return `${refusalLabel}: ${refusalReasons.get(refusal) ?? refusal}.`;
}

export const admits = ["anyone", "team", "list"] as const;

type Admit = (typeof admits)[number];

export type Access = { admit: Admit; senders: string[] };

export const defaultAccess: Access = { admit: "team", senders: [] };

export type Arrival = {
  fromSelf: boolean;
  spam: boolean;
  withinPlan: boolean;
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

  if (!arrival.withinPlan) return "plan_limit";

  // Listed senders wake the agent whether the whole team does too or only they do.
  const listed = isListed(arrival);

  if (arrival.access.admit === "list" && !listed) return "sender";

  if (arrival.access.admit === "team" && !arrival.fromTeam && !listed) return "outsider";

  if (arrival.access.admit !== "anyone" && !arrival.fromVerified) return "unverified";

  if (arrival.wakesInLastHour >= limits.wakesPerHour) return "rate_limit";

  return null;
}

export const admissions = ["team", "listed", "anyone"] as const;

export type Admission = (typeof admissions)[number];

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
