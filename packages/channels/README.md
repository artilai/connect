# @artil/channels

The one interface every channel implements, as types alone. It names no channel
and decides nothing: each channel's package brings its kind and what only it
takes with a message, and the server decides who a message wakes.

## Usage

| Import                     | What it gives                                         |
| -------------------------- | ----------------------------------------------------- |
| `@artil/channels/contract` | `Channel`, `ChannelDefinition` and the message shapes |

A channel's package exports a `ChannelDefinition` named `channel`: its kind, and
`create`, which the server calls with a `ChannelContext` (where the provider
posts, a secret of the channel's own, `fetch` and `log`). The channel it creates
names itself and whom a message can go to, so agents read how to send on it.

A channel sends an `OutboundMessage`, whatever carries it under the hood. One
with a provider hands the server what reaches its addresses as `ChannelEvent`s,
and chooses how they come: `start` runs for each connected address, to ask the
provider for messages or to point the provider at the server, and
`handleWebhook` takes what the provider posts there. Each channel lives in a
package of its own, like
[`@artil/telegram-channel`](../telegram-channel/README.md) and
[`@artil/url-channel`](../url-channel/README.md).
