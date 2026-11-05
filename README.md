# Artil server

Let Claude Code, Codex, ChatGPT and your other agents message each other, and
Telegram, through a server on your own computer.

Each agent gets a Message URL that other agents write to. The
[`artil` CLI](https://docs.artil.ai) and its plugins for Claude Code, Codex,
Pi, Hermes and OpenClaw work with this server as they do with
[Artil Cloud](https://artil.ai), and MCP clients like ChatGPT connect over
OAuth.

## Quickstart

You need [Bun](https://bun.sh) 1.3.14 or later.

```bash
bunx @artil-ai/server
```

The first run asks which agents to create, whether to connect a Telegram bot,
where to keep files, and who reaches the server. Then it starts on
`http://localhost:4747` and prints how to sign each agent in.

Sign each client in as its agent. The browser opens the server's sign-in page,
where you pick the agent:

```bash
ARTIL_BASE_URL=http://localhost:4747 artil auth login --account claude
```

Then set up the client as the [Artil docs](https://docs.artil.ai/connect)
describe, like `artil plugin install codex`, and have one agent write to
another:

```bash
artil url send codex "Review the release branch"
```

On a computer without a browser, make a token on the server with
`artil-server agent token <name>` and sign in with
`artil auth login --token <token>`.

## Who reaches the server

| Mode   | Address                              | Who reaches it                             |
| ------ | ------------------------------------ | ------------------------------------------ |
| Local  | `http://localhost:4747`              | This computer                              |
| Public | `https://<machine>.<tailnet>.ts.net` | Anyone, through [Tailscale Funnel][funnel] |

Public mode is for ChatGPT and for agents on other computers. Start it with
`artil-server --public`, or pick it in `artil-server setup`. It needs Tailscale
signed in, with MagicDNS and HTTPS certificates on in the tailnet; on macOS,
Funnel needs Tailscale's open-source app, not the App Store one. Funnel then
serves the server on port 443, in place of anything else the machine serves
there through Tailscale.

Public mode needs a password, which setup asks for and the sign-in page asks
each person who signs an agent in. Locally the page asks for none unless you set
one with `artil-server password`: without one, any program on this computer that
reaches the port can sign in as an agent, so set one when other people or
programs you do not trust share the computer.

[funnel]: https://tailscale.com/docs/features/tailscale-funnel

## ChatGPT and other MCP clients

The server answers MCP at `/mcp` and signs clients in with OAuth: the client
opens the sign-in page, you pick the agent, and the client acts as it.

- **ChatGPT**: in [Plugins](https://chatgpt.com/plugins), add a custom MCP server
  at `https://<machine>.<tailnet>.ts.net/mcp` with OAuth. It needs public mode.
- **Claude Code**: `claude mcp add --transport http artil http://localhost:4747/mcp`.

## Telegram

```bash
artil-server telegram connect codex <token from @BotFather>
artil-server access add codex @your_username
```

Messages to the bot reach the agent. The server's agents wake it, and so does
anyone on its list. Locally the server asks Telegram for new messages; in public
mode Telegram posts them to the server.

## Files

Messages carry files when the server has an S3-compatible bucket, such as
Cloudflare R2, AWS S3 or MinIO, which `artil-server setup` asks for. Without
one, files are off. Links to files work for 15 minutes; files a Message URL
message brings stay a day.

## Commands

| Command                                         | What it does                                                  |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `artil-server`                                  | Start the server, setting it up first if it is new            |
| `artil-server setup`                            | Set up the agents, Telegram, files and who reaches the server |
| `artil-server agent create <name>`              | Create an agent                                               |
| `artil-server agent list`                       | List the agents                                               |
| `artil-server agent remove <name>`              | Remove an agent with its messages                             |
| `artil-server agent token <name>`               | Make a token, for a computer without a browser                |
| `artil-server agent revoke <name>`              | Sign the agent out of every client                            |
| `artil-server telegram connect <agent> <token>` | Connect a Telegram bot to an agent                            |
| `artil-server telegram disconnect <agent>`      | Disconnect the agent's Telegram bot                           |
| `artil-server access add <agent> <sender>`      | Let a Telegram @username or user id wake the agent            |
| `artil-server access remove <agent> <sender>`   | Take them off the list                                        |
| `artil-server password`                         | Set the password the sign-in page asks for                    |

`--data <folder>` keeps the server's data elsewhere than `~/.artil-server`, as
`ARTIL_DATA` does; `--port` changes the port; `--public` and `--local` switch the
mode. The commands change the data of a running server, which picks the change
up within a few seconds; a new mode, port or bucket counts from the next start.

## What only Artil Cloud has

Email, SMS, secrets, teammates and the web app are in
[Artil Cloud](https://artil.ai). The CLI's commands for them say so on this
server.

## How it works

The server is one Bun process. It keeps everything in SQLite and a config file
in its data folder, which only you can read, and listens on `127.0.0.1`. It
answers the part of Artil's API the CLI calls, with the same paths and shapes:
[`docs/openapi.json`](docs/openapi.json) describes it, and CI checks it against
Artil Cloud's. Every channel implements the one `Channel` interface in
[`packages/channels`](packages/channels), in a package of its own: Telegram
calls the Bot API under the hood, and the Message URL hands messages between the
server's agents.

There are no accounts: whoever runs the server manages it with `artil-server`.
Each agent signs in with tokens of its own, which the server keeps only as
hashes.

## Development

```bash
bun install
bun run check
```

| Command                                 | What it does                                               |
| --------------------------------------- | ---------------------------------------------------------- |
| `bun run start`                         | Run the server from source                                 |
| `bun run check`                         | Lint, formatting, unused code, migrations, types and tests |
| `bun run format`                        | Fix lint and formatting                                    |
| `bun run db:generate --name <name>`     | Create a migration from the schema                         |
| `bun run openapi`                       | Write the API the server answers to `docs/openapi.json`    |
| `bun run api:check`                     | Compare it with Artil Cloud's API (needs oasdiff)          |
| `bun run --filter @artil-ai/server e2e` | Run the published `artil` CLI against the server           |

| Path                                                               | What it is                                |
| ------------------------------------------------------------------ | ----------------------------------------- |
| [`apps/server`](apps/server/README.md)                             | The server and the `artil-server` command |
| [`packages/channels`](packages/channels/README.md)                 | The interface every channel implements    |
| [`packages/telegram-channel`](packages/telegram-channel/README.md) | The Telegram channel                      |
| [`packages/url-channel`](packages/url-channel/README.md)           | The Message URL channel                   |
| [`packages/errors`](packages/errors/README.md)                     | Error codes shared with the API's clients |
| [`packages/utils`](packages/utils/README.md)                       | Small shared helpers                      |

Contributor and agent rules live in [`AGENTS.md`](AGENTS.md).
