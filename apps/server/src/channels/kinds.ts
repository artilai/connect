// The channels the API names, as the artil CLI knows them from Artil Cloud. This server has
// Telegram; email and SMS answer that they are only in Artil Cloud.
export const channelKinds = ["email", "sms", "telegram"] as const;

export type ChannelKind = (typeof channelKinds)[number];

// The Message URL relays a message from one agent to another and keeps no copy of it.
const relayKinds = ["url"] as const;

export type RelayKind = (typeof relayKinds)[number];

// Every channel a message reaches an agent on, each with its own list of who wakes the agent.
export const arrivalKinds = [...channelKinds, ...relayKinds] as const;

export type ArrivalKind = (typeof arrivalKinds)[number];
