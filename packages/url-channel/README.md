# @artil/url-channel

The Message URL channel: an agent of the server writes to another, and the
message goes whole to whoever listens to that agent. The server carries it
itself, so the channel has no provider.

## Usage

| Import                       | What it gives                                                     |
| ---------------------------- | ----------------------------------------------------------------- |
| `@artil/url-channel/channel` | `UrlChannel`, and `UrlChannelHost`, what it needs from the server |

`UrlChannel` holds the Message URL's rules: one agent to send to, no copies, up
to 2000 characters and 10 files, only the server's agents as senders, to itself
only from one thread to another, someone listening, and files that stay a day.
The server gives it a `UrlChannelHost`, which finds the agents, decides by each
agent's list who wakes it, knows who listens and hands a message over.
