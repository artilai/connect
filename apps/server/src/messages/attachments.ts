import { z } from "zod";

import type { FileLinks } from "../files/links";
import type { MessageAttachment } from "../files/repository";

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

type ToAttachmentOptions = {
  links: FileLinks;
  // When the link stops working, for a file the server keeps only until then.
  until?: number;
};

export function toAttachment(
  { fileId, name, type, size }: MessageAttachment,
  { links, until }: ToAttachmentOptions,
): Attachment {
  return {
    id: fileId,
    name,
    type,
    size,
    url: fileId === null ? null : links.link({ fileId, until }),
  };
}
