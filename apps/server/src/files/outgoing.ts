import { z } from "zod";

import type { FilesService, Upload } from "./service";

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

const encoder = new TextEncoder();

type ReadAttachmentsOptions = {
  files: FilesService;
  agentId: string;
  attachments: readonly AttachmentInput[];
};

// Reads the files a message to send names, with their bytes.
export function readAttachments({
  files,
  agentId,
  attachments,
}: ReadAttachmentsOptions): Promise<Upload[]> {
  return Promise.all(
    attachments.map(async (file) => {
      if ("id" in file) return files.readForSending({ agentId, fileId: file.id });

      const content = encoder.encode(file.text);

      return { name: file.name, type: file.type, size: content.byteLength, content };
    }),
  );
}
