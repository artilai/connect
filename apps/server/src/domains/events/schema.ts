import { z } from "zod";

import type { events } from "../../platform/db/schema";
import { channelKindSchema, type ChannelKind } from "../channels/schema";
import {
  attachmentSchema,
  type FileLinks,
  type MessageAttachment,
  toAttachment,
} from "../files/schema";
import { teammateSchema, toTeammate } from "../team/schema";

export type EventRow = typeof events.$inferSelect;

// A message the event points at, which the client reads.
type Arrival = { type: "message.received"; channel: ChannelKind; messageId: string };

// A message on the Message URL, which the event also brings whole: with its sender, the sender's
// thread to answer in, the account's thread it is for, and the client the sender wrote it in.
export type Relay = {
  type: "message.received";
  channel: ChannelKind;
  messageId: string;
  text: string | null;
  sender: { id: string; name: string };
  thread: string | null;
  toThread: string | null;
  client: string | null;
};

export type NewEvent = Arrival | Relay;

type Stamped<Record> = Record & { id: number; createdAt: Date };

export type RelayRecord = Stamped<Relay> & { attachments: MessageAttachment[] };

export type EventRecord = Stamped<Arrival> | RelayRecord;

export function isRelay(event: EventRecord): event is RelayRecord {
  return "sender" in event;
}

const relayedAttachmentsSchema = z
  .array(attachmentSchema)
  .optional()
  .describe("The files that came with a message relayed by the Message URL");

export const eventSchema = z
  .object({
    id: z.int(),
    type: z.literal("message.received"),
    channel: channelKindSchema,
    messageId: z.uuid().describe("The message's id, to read it with"),
    text: z
      .string()
      .nullable()
      .optional()
      .describe("The text of a message the Message URL relayed, which comes whole"),
    sender: teammateSchema.optional().describe("The agent who sent a relayed message"),
    thread: z
      .string()
      .nullable()
      .optional()
      .describe("The thread of the sender's client a relayed message came from, to answer in"),
    toThread: z
      .string()
      .nullable()
      .optional()
      .describe("The thread of the agent's client a relayed message is for"),
    client: z
      .string()
      .nullable()
      .optional()
      .describe("The client the sender wrote a relayed message in, like Codex or ChatGPT"),
    attachments: relayedAttachmentsSchema,
    createdAt: z.date(),
  })
  .meta({ id: "Event" });

export type Event = z.infer<typeof eventSchema>;

export function toEvent(event: EventRecord, links: FileLinks): Event {
  return isRelay(event)
    ? {
        ...event,
        sender: toTeammate(event.sender),
        attachments: event.attachments.map((attachment) => toAttachment(attachment, { links })),
      }
    : event;
}
