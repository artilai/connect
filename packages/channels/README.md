# @artil/channels

The class every channel extends, and the shapes of the messages it carries. It
names no channel and decides nothing: each channel's package brings its kind and
what only it takes with a message, and the server decides who a message wakes.

## Usage

| Import                     | What it gives                                       |
| -------------------------- | --------------------------------------------------- |
| `@artil/channels/contract` | `Channel`, the message shapes and `contractVersion` |

A channel's package exports the channel itself, named `channel`, which the server loads.

A release that breaks channels built for the last one raises `contractVersion` by one, and the pull requests before it leave it as it is: the server loads only channels of its own version.
