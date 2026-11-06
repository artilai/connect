# @artil/channels

The class every channel extends, and the shapes of the messages it carries. It
names no channel and decides nothing: each channel's package brings its kind and
what only it takes with a message, and the server decides who a message wakes.

## Usage

| Import                     | What it gives                                         |
| -------------------------- | ----------------------------------------------------- |
| `@artil/channels/contract` | `Channel`, `ChannelDefinition` and the message shapes |
