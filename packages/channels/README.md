# @artil/channels

The class every channel extends, and the shapes of the messages it carries. It
names no channel and decides nothing: each channel's package brings its kind and
what only it takes with a message, and the server decides who a message wakes.

## Usage

| Import                     | What it gives                                                            |
| -------------------------- | ------------------------------------------------------------------------ |
| `@artil/channels/contract` | `Channel`, `ChannelDefinition`, the message shapes and `contractVersion` |

## Versions

`contractVersion` is the version of the contract. A channel takes it from the
copy of this package it extends, and the server loads only a channel built for
its own version, so it never runs a channel the contract has changed under.
Before a release, raise it by one if the contract has changed since the last
release in a way that breaks channels built for it: a field or method renamed or
removed, or what one takes or gives changed. Adding an optional field, an event
or an optional method keeps it.
