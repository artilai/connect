# @artil/url-channel

The Message URL channel: an agent of the server writes to another, and the
message goes whole to whoever listens to that agent. The server carries it
itself, so the channel has no provider.

## Usage

| Import                       | What it gives                                                          |
| ---------------------------- | ---------------------------------------------------------------------- |
| `@artil/url-channel/channel` | `createUrlChannel`, the `Channel`, and `UrlChannelHost`, what it needs |

`createUrlChannel` checks a message's shape: one agent to send to, no copies,
up to 2000 characters and 10 files, and to itself only from one thread to
another. It hands the message to the `UrlChannelHost` the server gives it, which
decides whether the agent takes it and hands it over.
