# @artil/channels

The one interface every channel implements, as types alone. It names no channel
and decides nothing: each channel's package brings its kind and what only it
takes with a message, and the server decides who a message wakes.

## Usage

| Import                     | What it gives                                              |
| -------------------------- | ---------------------------------------------------------- |
| `@artil/channels/contract` | The `Channel` type and inbound and outbound message shapes |

A channel sends an `OutboundMessage`, whatever carries it under the hood. One
with a provider hands the server what reaches its addresses as `ChannelEvent`s,
and chooses how they come: `start` runs for each connected address, to ask the
provider for messages or to point the provider at the server, and
`handleWebhook` takes what the provider posts there. Each channel lives in a
package of its own, like
[`@artil/telegram-channel`](../telegram-channel/README.md) and
[`@artil/url-channel`](../url-channel/README.md).
