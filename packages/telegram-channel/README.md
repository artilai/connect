# @artil/telegram-channel

The Telegram channel: a bot that takes messages through the Bot API, by webhook
or by asking for updates, and sends them back.

## Usage

| Import                            | What it gives                                                   |
| --------------------------------- | --------------------------------------------------------------- |
| `@artil/telegram-channel/channel` | `createTelegramChannel`, the `Channel` over a Telegram provider |
| `@artil/telegram-channel/bot-api` | `createBotApi`, the provider that calls the Bot API             |
| `@artil/telegram-channel/chats`   | Reading Telegram user ids and @usernames                        |
