import { z } from "zod";

import { admissions, type messages, refusals } from "../../platform/db/schema";
import { labelSchema } from "../../platform/http/validate";
import { type ChannelKind, channelKindSchema } from "../channels/schema";
import {
  attachmentSchema,
  attachmentsSchema,
  type FileLinks,
  type MessageAttachment,
  toAttachment,
} from "../files/schema";

export const messageListLimit = 50;

export type MessageRow = typeof messages.$inferSelect;

export type MessageRecord = Omit<
  MessageRow,
  "accountId" | "externalId" | "externalThread" | "clientThread" | "answeredAt"
> & {
  toNames: (string | null)[];
  attachments: MessageAttachment[];
};

export type NewMessage = Omit<typeof messages.$inferInsert, "createdAt">;

// A null accountId lists every account's messages, as on a shared channel.
export type MessageFilter = {
  accountId: string | null;
  channel?: ChannelKind;
  direction?: "inbound" | "outbound";
  counterpart?: string;
  // Lists the messages older than this one, to page back.
  before?: string;
  limit?: number;
};

export const directionSchema = z.enum(["inbound", "outbound"]);

export const searchSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .exactOptional()
  .describe("Find the messages that hold any of these words, up to 10, best match first");

const maxRecipients = 10;

const maxText = 32_000;

export const draftSchema = z.object({
  replyTo: z.uuid("replyTo must be a message id").optional(),
  forward: z.uuid("forward must be a message id").optional(),
  channel: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("The channel to start a conversation on, by its kind, from listChannels"),
  to: z
    .array(z.string().trim().min(1).max(320))
    .max(maxRecipients, `Send to at most ${maxRecipients} recipients`)
    .optional(),
  cc: z.array(z.string().trim().min(1).max(320)).max(50, "Copy at most 50 addresses").optional(),
  subject: z.string().trim().max(240, "Subject must be at most 240 characters").optional(),
  text: z.string().min(1, "Text cannot be empty").max(maxText, "Text is too long"),
  attachments: attachmentsSchema.optional(),
  // A thread is whatever a client calls its conversation, like a Codex thread id.
  thread: labelSchema("A thread", 128)
    .optional()
    .describe("The thread of your client you send from, which an answer to the message wakes"),
});

export type Draft = z.infer<typeof draftSchema>;

export const messageSchema = z
  .object({
    id: z.uuid(),
    addressId: z.uuid().describe("The agent's address the message came to or went from"),
    channel: channelKindSchema,
    direction: directionSchema,
    counterpart: z
      .string()
      .describe(
        "Who sent an inbound message, or the group it came in, or the recipients of an outbound one",
      ),
    counterpartName: z
      .string()
      .nullable()
      .describe("The name an inbound message's sender or group goes by, when the channel tells it"),
    author: z
      .string()
      .nullable()
      .describe("Who wrote an inbound message in a group, such as a Telegram user id"),
    authorName: z
      .string()
      .nullable()
      .describe("The name the author goes by, when the channel tells it"),
    to: z.array(z.string()).describe("Whom the message names as its recipients"),
    toNames: z
      .array(z.string().nullable())
      .describe(
        "The name each recipient in to goes by, in the same order: one of the server's accounts by its name, or else null",
      ),
    cc: z.array(z.string()).describe("Empty: copies are email's, which only Artil Cloud carries"),
    subject: z.string().nullable().describe("The subject, on a channel whose messages have them"),
    text: z.string(),
    attachments: z.array(attachmentSchema),
    thread: z
      .object({ messageId: z.string(), references: z.array(z.string()) })
      .nullable()
      .describe("Null: Message-IDs are email's, which only Artil Cloud carries"),
    status: z.enum(["received", "refused", "sending", "sent", "failed"]),
    refusal: z.enum(refusals).nullable().describe("Why a refused message did not wake the agent"),
    admission: z
      .enum(admissions)
      .nullable()
      .describe(
        "Who the sender of a received message is to the agent: `team` for another agent of the server, `listed` for a sender on the channel's list, and `anyone` for everyone else",
      ),
    error: z.string().nullable().describe("Why a failed message was not sent"),
    createdAt: z.date(),
  })
  .meta({ id: "Message" });

type Message = z.infer<typeof messageSchema>;

export function toMessage({ attachments, ...message }: MessageRecord, links: FileLinks): Message {
  return {
    ...message,
    // Copies and Message-IDs are email's, which only Artil Cloud carries.
    cc: [],
    thread: null,
    attachments: attachments.map((attachment) => toAttachment(attachment, { links })),
  };
}
