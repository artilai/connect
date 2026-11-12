# @artil/telegram-channel

The Telegram channel: a bot that takes messages through the Bot API, by webhook
or by asking for updates, and sends them back.

## Usage

| Import                    | What it gives                           |
| ------------------------- | --------------------------------------- |
| `@artil/telegram-channel` | `channel`, the channel the server loads |

A bot connects with its token: open [@BotFather](https://t.me/BotFather) in
Telegram, send `/newbot` to make a bot or `/mybots` to pick one you have, tap
**API Token** and copy it. On the server's computer, connect the bot to an
account, pasting the token when asked, then let your Telegram account wake the
agent:

```bash
artil-connect account connect <account> telegram
artil-connect account allow <account> <@telegram_username> --channel telegram
```

Open the bot in Telegram, tap **Start** and send a task. People write to the bot
first, in a private chat or by tagging it in a group it is in, and the agent
answers them in the same chat. Once the agent reads a message that woke it, its
bot reacts to it with 👀 until the agent answers, so the sender knows the agent
has it.

`artil-connect account show <account>` shows the bot and who may wake the agent,
and `artil-connect account disconnect <account> telegram` disconnects it.
