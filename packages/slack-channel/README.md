# @artil/slack-channel

The Slack channel: a Slack app's bot that takes messages over Socket Mode, which
works on any computer, and sends them back through the Web API.

## Usage

| Import                 | What it gives                           |
| ---------------------- | --------------------------------------- |
| `@artil/slack-channel` | `channel`, the channel the server loads |

An app connects with two tokens, its bot token and its app-level token. To make
an app with both:

1. At [api.slack.com/apps](https://api.slack.com/apps), choose Create New App,
   then From a manifest, pick the workspace and paste this, named after the
   agent:

   ```yaml
   display_information:
     name: Claude
   features:
     app_home:
       messages_tab_enabled: true
       messages_tab_read_only_enabled: false
     bot_user:
       display_name: Claude
       always_online: true
   oauth_config:
     scopes:
       bot:
         - app_mentions:read
         - channels:read
         - chat:write
         - files:read
         - files:write
         - groups:read
         - im:history
         - im:write
         - users:read
   settings:
     event_subscriptions:
       bot_events:
         - app_mention
         - message.im
     socket_mode_enabled: true
   ```

2. Install the app to the workspace, and copy its Bot User OAuth Token, which
   starts with `xoxb-`, from OAuth & Permissions.
3. Under Basic Information, generate an App-Level Token with the
   `connections:write` scope, which starts with `xapp-`.
4. Connect the app with `artil-connect account connect <account> slack`, giving
   both tokens with a space between.

People then write to the bot in its Messages tab, or mention it in a channel it
is in, and the agent answers them, in a channel in the thread of what it
answers. The agent writes in Markdown, up to 12,000 characters, to a person by
their member id, which Copy member ID in their profile gives, or to a channel
the bot is in by the id at the bottom of its details.
