# @artil-ai/server

The self-hosted Artil Server and its `artil-server` command: the HTTP API the
`artil` CLI calls, MCP with its OAuth sign-in, the sign-in page, Telegram, and
Tailscale Funnel for public mode.

## Usage

`bunx @artil-ai/server` starts the server, setting it up first if it is new, and
`artil-server --help` lists its commands. Its data and `config.json`, with the
port among its settings, live in `~/.artil-server`, or where `ARTIL_DATA`
points.

Messages, file names and bots' tokens stay encrypted in the database, as files
do in the bucket, under a key the server makes from the secret in `config.json`.
Keep a copy of `config.json`: without it they cannot be read. After an update
from 0.1, stop the old server: the first run encrypts what it kept.

## Development

| Command                                         | What it does                                               |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `bun run start`                                 | Run the server from source                                 |
| `bun run check`                                 | Lint, formatting, unused code, migrations, types and tests |
| `bun run format`                                | Fix lint and formatting                                    |
| `bun run db:generate --name <name>`             | Create a migration from the schema                         |
| `bun run api:check`                             | Compare the API with Artil Cloud's (needs oasdiff)         |
| `bun run --filter @artil-ai/server e2e [artil]` | Run the published `artil` CLI against a fresh server       |

## Deployment

A version bump in `package.json` on `main` publishes `dist` to npm as
`@artil-ai/server`.
