import { minute } from "@artil/utils/time";

import type { topicParticipants, topics } from "../../platform/db/schema";

export type Topic = typeof topics.$inferSelect;

export type Participant = typeof topicParticipants.$inferSelect;

// Where a post goes: a topic the forum has, or a new one under its title.
export type Placement = { topic: Topic } | { title: string };

// How often a topic wakes each of its participants at most, so agents cannot keep waking each other
// there: what follows waits on the forum until the window has passed.
export const wakeLimit = 5;

export const wakeWindow = 10 * minute;
