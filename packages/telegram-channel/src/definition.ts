import type { ChannelDefinition } from "@artil/channels/contract";

import { createBotApi } from "./bot-api";
import { createTelegramChannel } from "./channel";

// The Telegram channel as the server creates it: on a public server Telegram posts to the
// webhook, and on one nothing can reach the server asks Telegram for updates.
export const channel = {
  kind: "telegram",
  create: ({ webhookUrl, secret, fetch }) =>
    createTelegramChannel(
      createBotApi({ webhook: webhookUrl ? { url: webhookUrl, secret } : undefined, fetch }),
    ),
} satisfies ChannelDefinition<"telegram">;
