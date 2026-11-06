import { z } from "zod";

import type { files } from "../../platform/db/schema";
import type { createFileLinks } from "./links";

const maxAttachments = 10;

const maxTextFileSize = 1_000_000;

// The shape of a media type like application/pdf.
const mediaType = /^[\w.+\-]+\/[\w.+\-]+$/v;

const sentFileSchema = z
  .object({ id: z.uuid("A file to send on goes by its id") })
  .describe("A file from a message the agent received or sent, by the id in its attachments");

const writtenFileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "A file needs a name")
      .max(255, "A file name must be at most 255 characters"),
    type: z.string().regex(mediaType, "A file's type must be a media type, like text/plain"),
    text: z
      .string()
      .max(maxTextFileSize, `A text file holds at most ${maxTextFileSize / 1_000_000} MB`),
  })
  .describe("A text file written for this message");

// The files a message to send names: ones its sender has, and text files written for it.
export const attachmentsSchema = z
  .array(z.union([sentFileSchema, writtenFileSchema]))
  .max(maxAttachments, `Send at most ${maxAttachments} files`);

export type AttachmentInput = z.infer<typeof attachmentsSchema>[number];

export type FileRecord = typeof files.$inferSelect;

// What a message tells of a file: its id when the server keeps its bytes, its description, and
// when the server lets go of a file it keeps only for a while.
export type MessageAttachment = {
  fileId: string | null;
  name: string;
  type: string;
  size: number;
  expiresAt: Date | null;
};

export type FileLinks = ReturnType<typeof createFileLinks>;

export function toMessageAttachment({
  id,
  name,
  type,
  size,
  key,
  expiresAt,
}: FileRecord): MessageAttachment {
  return { fileId: key === null ? null : id, name, type, size, expiresAt };
}

export const attachmentSchema = z.object({
  id: z
    .uuid()
    .nullable()
    .describe(
      "The file's id, to send it on in attachments; null when the server kept only the file's description",
    ),
  name: z.string(),
  type: z.string(),
  size: z.number(),
  url: z
    .string()
    .nullable()
    .describe(
      "Where to download the file: a link that needs no sign-in and expires after 15 minutes, so read the message again for a new one; null when the server kept only the file's description",
    ),
});

export type Attachment = z.infer<typeof attachmentSchema>;

type ToAttachmentOptions = { links: FileLinks };

// A file the server keeps only for a while has a link that works as long as the file is there.
export function toAttachment(
  { fileId, name, type, size, expiresAt }: MessageAttachment,
  { links }: ToAttachmentOptions,
): Attachment {
  return {
    id: fileId,
    name,
    type,
    size,
    url: fileId === null ? null : links.link({ fileId, until: expiresAt?.getTime() }),
  };
}
