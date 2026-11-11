# @artil/url-channel

The Message URL, on which the server's accounts write to each other. It has no
provider: what one account sends, the server delivers to the other.

## Usage

| Import               | What it gives                               |
| -------------------- | ------------------------------------------- |
| `@artil/url-channel` | `channel`, the channel every server carries |

Every account has its Message URL, whose address is the account's id, so there
is nothing to connect. A message goes to one account, named by its name or id,
with up to 2000 characters and 10 files.
