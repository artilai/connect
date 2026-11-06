# @artil-ai/server

The self-hosted Artil server and its `artil-server` command: the HTTP API the
`artil` CLI calls, MCP with its OAuth sign-in, the sign-in page, Telegram, and
Tailscale Funnel for public mode.

## Usage

`bunx @artil-ai/server` runs the published package; `artil-server --help` lists
its commands. The repository's [README](../../README.md) walks through setting
it up.

| Entry point            | What it does                                                      |
| ---------------------- | ----------------------------------------------------------------- |
| `src/main.ts`          | Reads the environment and runs the command line                   |
| `src/command/cli.ts`   | The commands, and the setup wizard in `src/command/setup.ts`      |
| `src/server.ts`        | Starts the server: database, Telegram, HTTP, Funnel               |
| `src/app.ts`           | The routes, built from the services in `src/services.ts`          |
| `src/channels/load.ts` | Loads the channels the config names, built in or of someone's own |
| `src/db/schema.ts`     | The SQLite schema, migrated from `migrations`                     |

## Development

| Command                             | What it does                                         |
| ----------------------------------- | ---------------------------------------------------- |
| `bun run build`                     | Write the npm package to `dist`                      |
| `bun run db:generate --name <name>` | Create a migration from the schema                   |
| `bun run db:check`                  | Fail when the schema and the migrations disagree     |
| `bun run openapi`                   | Write the API it answers to `docs/openapi.json`      |
| `bun run e2e [artil]`               | Run the published `artil` CLI against a fresh server |

Tests build the whole server on an in-memory database with `createTestServer`
from `src/testing.ts`, with a fake Telegram and an in-memory bucket.

## Deployment

A version bump in `package.json` on `main` publishes `dist` to npm as
`@artil-ai/server`.
