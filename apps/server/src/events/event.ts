import { z } from "zod";

import { day } from "@artil/utils/time";

import { channelKindSchema } from "../channels/kinds";
import type { FileLinks } from "../files/links";
import { attachmentSchema, toAttachment } from "../messages/attachments";
import { teammateSchema } from "../team/teammate";
import { type EventRecord, isRelay, type RelayRecord } from "./repository";

// A relayed message's files stay a day after it came.
const relayedFileLifetime = day;

const relayedAttachmentsSchema = z
  .array(
    attachmentSchema.extend({
      url: z
        .string()
        .nullable()
        .describe(
          "Where to download the file: a link that needs no sign-in and works as long as the server keeps the file, a day after the message came; null when the server kept only the file's description",
        ),
    }),
  )
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

export function relayedAttachments({ attachments, createdAt }: RelayRecord, links: FileLinks) {
  const until = createdAt.getTime() + relayedFileLifetime;

  return attachments.map((attachment) => toAttachment(attachment, { links, until }));
}

export function presentEvent(event: EventRecord, links: FileLinks): Event {
  return isRelay(event) ? { ...event, attachments: relayedAttachments(event, links) } : event;
}
