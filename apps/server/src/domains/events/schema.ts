import { z } from "zod";

import type { events } from "../../platform/db/schema";
import { channelKindSchema, type ChannelKind } from "../channels/schema";

export type EventRow = typeof events.$inferSelect;

// A message the event points at, which the client reads, and the thread of the client it is for.
export type NewEvent = {
  type: "message.received";
  channel: ChannelKind;
  messageId: string;
  toThread: string | null;
};

export type EventRecord = NewEvent & { id: number; createdAt: Date };

export const eventSchema = z
  .object({
    id: z.int(),
    type: z.literal("message.received"),
    channel: channelKindSchema,
    messageId: z.uuid().describe("The message's id, to read it with"),
    toThread: z
      .string()
      .nullable()
      .describe(
        "The thread of the agent's client the message is for: the one that wrote what it answers, or else the last one whose message reached its sender",
      ),
    createdAt: z.date(),
  })
  .meta({ id: "Event" });

export type Event = z.infer<typeof eventSchema>;
