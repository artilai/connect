# @artil/channels

The class every channel extends, and the shapes of the messages it carries. It
names no channel and decides nothing: each channel's package brings its kind and
how it reaches its provider, and the server decides who a message wakes.

## Usage

| Import                     | What it gives                                       |
| -------------------------- | --------------------------------------------------- |
| `@artil/channels/contract` | `Channel`, the message shapes and `contractVersion` |

A channel's package exports the channel itself, named `channel`, which the server loads.
A channel without a provider, like the Message URL, hands what it sends back to
the server with `deliver`, which takes it as a message the server's accounts
received.

A channel whose provider threads messages, like Slack, names the thread of each
message it takes and sends, and gets the thread of the message an answer
answers.

A channel that can show someone what the agent did with their message, like a
reaction on Telegram, has `markRead` and `markAnswered`. The server calls them
for a message that woke the agent, once the agent reads it and once it answers
it, and goes on without waiting for them.

A release that breaks channels built for the last one raises `contractVersion` by one, and the pull requests before it leave it as it is: the server loads only channels of its own version.
