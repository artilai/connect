# @artil-ai/connect

The self-hosted Artil Connect server and its `artil-connect` command: the HTTP API the
`artil` CLI calls, MCP with its OAuth sign-in, the sign-in page, Telegram, and
Tailscale Funnel for public mode.

## Usage

`bunx @artil-ai/connect` starts the server, setting it up first if it is new, and
`artil-connect --help` lists its commands. Its data and `config.json` live in
`~/.artil-connect`, or where `ARTIL_DATA` points, and `artil-connect set` changes
the port, the mode and the sign-in page's password. A server set up as Artil
Server, before 0.5.0, keeps its data in `~/.artil-server` until you move it.

Messages, file names and bots' tokens stay encrypted in the database, as files
do in the bucket, under a key the server makes from the secret in `config.json`.
Keep a copy of `config.json`: without it they cannot be read.

## Development

| Command                                          | What it does                                               |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `bun run start`                                  | Run the server from source                                 |
| `bun run check`                                  | Lint, formatting, unused code, migrations, types and tests |
| `bun run format`                                 | Fix lint and formatting                                    |
| `bun run db:generate --name <name>`              | Create a migration from the schema                         |
| `bun run api:check`                              | Compare the API with Artil Cloud's (needs oasdiff)         |
| `bun run --filter @artil-ai/connect e2e [artil]` | Run the published `artil` CLI against a fresh server       |

## Deployment

A version bump in `package.json` on `main` publishes `dist` to npm as
`@artil-ai/connect`.
