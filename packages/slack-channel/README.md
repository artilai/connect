# @artil/slack-channel

The Slack channel: a Slack app's bot that takes messages over Socket Mode, which
works on any computer, and sends them back through the Web API.

## Usage

| Import                 | What it gives                           |
| ---------------------- | --------------------------------------- |
| `@artil/slack-channel` | `channel`, the channel the server loads |

`artil-connect account connect <account> slack` gives a link that makes the
account's [Slack app](https://api.slack.com/apps), with
[Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode), the
events and the scopes it needs, then asks for the app's bot token and an
[app-level token](https://docs.slack.dev/authentication/tokens).

The bot answers direct messages, and mentions in channels it is in, in the
thread of what it answers. A mention in a thread carries what was said there
since the bot last wrote, quoted above it. A server set up before it carried Slack loads it
once `"slack"` is in `channels` in its `config.json`.
