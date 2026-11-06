# @artil/telegram-channel

The Telegram channel: a bot that takes messages through the Bot API, by webhook
or by asking for updates, and sends them back.

## Usage

| Import                    | What it gives                                                 |
| ------------------------- | ------------------------------------------------------------- |
| `@artil/telegram-channel` | `channel`, the definition the server creates the channel from |

Inside, `TelegramChannel` in `src/channel.ts` turns what a provider hands over
into the contract's messages, and `createBotApi` in `src/bot-api.ts` is the
provider that calls the Bot API.
