# @artil/channels

The class every channel extends, and the shapes of the messages it carries. It
names no channel and decides nothing: each channel's package brings its kind and
what only it takes with a message, and the server decides who a message wakes.

## Usage

| Import                     | What it gives                                         |
| -------------------------- | ----------------------------------------------------- |
| `@artil/channels/contract` | `Channel`, `ChannelDefinition` and the message shapes |

A channel extends `Channel` and overrides what it does differently from the
defaults: it names its `kind`, its `name` and its `recipients`, and implements
`send`. Without `start` nothing keeps messages coming, and without `connect` or
`handleWebhook` the channel has no addresses to connect or takes no webhooks.
`readSender`, `recipientWritesFirst`, `prepare` and `disconnect` do nothing
special until a channel overrides them.

A channel's package exports a `ChannelDefinition` named `channel`: its kind, and
`create`, which the server calls with a `ChannelContext` (where the provider
posts, a secret of the channel's own, `fetch` and `log`). The server checks the
channel it gets by its shape, so a channel built against another copy of this
package works too. Each channel lives in a package of its own, like
[`@artil/telegram-channel`](../telegram-channel/README.md) and
[`@artil/url-channel`](../url-channel/README.md).
