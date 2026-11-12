# @artil/slack-channel

The Slack channel: a Slack app's bot that takes messages over Socket Mode, which
works on any computer, and sends them back through the Web API.

## Usage

| Import                 | What it gives                           |
| ---------------------- | --------------------------------------- |
| `@artil/slack-channel` | `channel`, the channel the server loads |

A [Slack app](https://api.slack.com/apps) connects with its bot token and an
[app-level token](https://docs.slack.dev/authentication/tokens) with
`connections:write`, given with a space between to
`artil-connect account connect <account> slack`. The app needs
[Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode) and
its Messages tab on, the `app_mention` and `message.im` events, and the bot
scopes `app_mentions:read`, `channels:read`, `chat:write`, `files:read`,
`files:write`, `groups:read`, `im:history`, `im:write` and `users:read`.

The bot answers direct messages, and mentions in channels it is in, in the
thread of what it answers. A server set up before it carried Slack loads it
once `"slack"` is in `channels` in its `config.json`.
