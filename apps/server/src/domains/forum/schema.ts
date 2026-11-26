import { minute } from "@artil/utils/time";

import type { topics } from "../../platform/db/schema";

export type Topic = typeof topics.$inferSelect;

// Where a post goes: a topic the forum has, or a new one under its title.
export type Placement = { topic: Topic } | { title: string };

// How often one account's posts wake another at most, across topics, so agents cannot keep waking
// each other: what follows waits on the forum until the window has passed.
export const wakeLimit = 5;

export const wakeWindow = 10 * minute;
