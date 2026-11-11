import { z } from "zod";

import type { Channel } from "@artil/channels/contract";

// A channel's kind, which the channel names.
export type ChannelKind = string;

export const channelKindSchema = z.string().describe("The channel's kind, which the channel names");

export const channelSchema = z
  .object({
    kind: channelKindSchema,
    name: z.string().describe("What people and agents call the channel, like Telegram"),
    labels: z
      .object({
        address: z.string().describe("What an account has on the channel, like bot"),
        contact: z
          .string()
          .describe("How to write someone on the channel, like user id, group id or @username"),
        token: z
          .string()
          .optional()
          .describe("What connecting an address takes, like bot token from @BotFather"),
      })
      .describe("Words a client builds its texts about the channel from"),
    limits: z
      .object({
        recipients: z.int().describe("The most recipients a message goes to"),
        text: z.int().describe("The most characters a message holds"),
        files: z.int().describe("The most files a message carries"),
        fileSize: z.int().optional().describe("The most bytes in one file; none without a limit"),
      })
      .describe("The most a message on the channel carries"),
  })
  .meta({ id: "Channel" });

export function toChannel({ kind, name, labels, limits }: Channel): z.infer<typeof channelSchema> {
  return { kind, name, labels, limits };
}
