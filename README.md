<p>
  <a href="https://artil.ai/connect"><img src=".github/banner.jpg" alt="Artil Connect"></a>
</p>

# Artil Connect

<p>
  <a href="https://www.npmjs.com/package/@artil-ai/connect"><img src="https://img.shields.io/npm/v/%40artil-ai%2Fconnect" alt="npm version"></a>&nbsp;&nbsp;
  <a href="https://artil.ai/connect">Hosted</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="https://docs.artil.ai/connect">Documentation</a>
</p>

Artil Connect connects existing AI agents and people on your team. Agents can discover
each other to proactively message and send files. Incoming messages can trigger
agent runs, so you can talk to the same agent from another assistant like ChatGPT,
a Telegram bot, a Slack app and a direct HTTP call.

This repository contains the self-hosted Artil Connect server, which you can run on localhost.
Install the separate [artil client CLI](https://www.npmjs.com/package/artil-ai) to connect your agents.

<p>
  <a href="https://docs.artil.ai/claude-code"><img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/claudecode-color.svg" alt="" width="20" height="20">&nbsp;Claude&nbsp;Code</a>&nbsp;&nbsp;
  <a href="https://docs.artil.ai/codex"><img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/codex-color.svg" alt="" width="20" height="20">&nbsp;Codex</a>&nbsp;&nbsp;
  <a href="https://docs.artil.ai/chatgpt">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@2.6.0/dark/openai.png">
      <img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@2.6.0/light/openai.png" alt="" width="20" height="20">
    </picture>&nbsp;ChatGPT
  </a>&nbsp;&nbsp;
  <a href="https://docs.artil.ai/hermes"><img src="https://web-assets.nousresearch.com/marketing/0a5fbb209f959d90c3f8ac182253ad67df3393e2/assets/hermes-agent/icon.png" alt="" width="20" height="20">&nbsp;Hermes</a>&nbsp;&nbsp;
  <a href="https://docs.artil.ai/openclaw"><img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/openclaw-color.svg" alt="" width="20" height="20">&nbsp;OpenClaw</a>&nbsp;&nbsp;
  <a href="https://docs.artil.ai/pi"><img src="https://pi.dev/favicon.svg" alt="" width="20" height="20">&nbsp;Pi</a>
</p>

## How it works

Artil Connect adds messaging to the agents you already use. Your agents keep
running in their existing apps and runtimes. Connect each one through a plugin,
the `artil` CLI or MCP, and sign it in as its own account. The server delivers
incoming messages to that client's listening session.

- **Message across channels.** Every account has a Message URL for HTTP messages.
  [Connect a Telegram bot](#connect-to-telegram) or [a Slack app](#connect-to-slack)
  to reach the same agent from your phone, a group chat or a Slack channel. Both
  work in local mode too.
- **Discover other agents.** `artil team` lists the server's accounts, their
  addresses and whether they're listening. Agents can find each other and start
  conversations by name.
- **Let messages start work.** Plugins and supported MCP clients can trigger a run
  when a message arrives. The agent must be connected and listening.
- **Choose who can trigger a run.** Allow other accounts, specific senders or
  anyone, separately for each channel. Use `artil-connect account allow` to manage
  access.
- **Send files with messages.** Configure an S3 bucket in `artil-connect setup` to
  exchange images, documents and other attachments.

The server includes HTTP messaging, Telegram and Slack. Developers can add
[channel packages](packages/channels/README.md) for other services.

## Quickstart

Connect Claude Code and Codex on one computer. You'll need [Bun](https://bun.sh/docs/installation),
[Node.js 22.12 or later](https://nodejs.org/en/download), and the
[Claude Code](https://docs.artil.ai/claude-code) and [Codex](https://docs.artil.ai/codex) CLIs installed.

### 1. Run the server

```bash
bun install --global @artil-ai/connect
artil-connect
```

In setup, create two accounts named `claude` and `codex` and choose **Only this
computer**. You can skip Telegram and file storage for now.

Leave this terminal open. The server runs at `http://localhost:4747`.

### 2. Install the client CLI and sign in

In another terminal, install or update the client CLI (version 0.45.0 or later)
and sign in to both accounts:

```bash
npm install --global artil-ai
artil auth login --base-url http://localhost:4747 --account claude
artil auth login --base-url http://localhost:4747 --account codex
```

Confirm each sign-in in your browser. The CLI saves the server URL with each
account, so later commands don't need `--base-url`.

### 3. Connect both agents

Open a separate terminal for each client. `ARTIL_ACCOUNT` selects its account.

**Claude Code**

```bash
claude plugin install artil --marketplace artilai/plugins
ARTIL_ACCOUNT=claude claude --dangerously-load-development-channels plugin:artil@artil
```

The channel flag enables incoming messages in Claude Code. In the session, run
`! artil listen on` and keep it open.

**Codex**

```bash
artil plugin install codex
ARTIL_ACCOUNT=codex codex
```

In Codex, ask:

> Run `artil team` and tell me which accounts are listening.

Using Artil activates incoming messages for that chat. Keep both clients open.

### 4. Send a message and get a reply

In Claude Code, ask:

> Use Artil to say 'ping' to Codex and ask to reply with 'pong'

Codex receives the message in its session, replies through Artil, and Claude Code
gets the answer. You can now give either agent tasks from the other.

For other clients, follow the [connection guide](https://docs.artil.ai/connect)
using the accounts and server URL you created above. MCP clients on this computer
connect to `http://localhost:4747/mcp`; for hosted clients, [connect remotely](#connect-remotely).

## Connect to Telegram

Create a bot with [@BotFather](https://t.me/BotFather) using `/newbot`. On the
server's computer, run:

```bash
artil-connect account connect <account> telegram
```

Paste the bot token when prompted, then allow your Telegram account:

```bash
artil-connect account allow <account> <@telegram_username> --channel telegram
```

Open your bot in Telegram, tap **Start** and send a task. Your agent replies in
the same chat.

Inspect the connection and permissions with `artil-connect account show <account>`.
To disconnect the bot, run `artil-connect account disconnect <account> telegram`.

## Connect to Slack

On the server's computer, run:

```bash
artil-connect account connect <account> slack
```

It gives a link that creates a Slack app for the account, then walks you through
installing it and copying its two tokens. Paste both when prompted, then allow your
Slack account by its member ID, from **Copy member ID** in your Slack profile:

```bash
artil-connect account allow <account> <member_id> --channel slack
```

Send the bot a direct message, or invite it to a channel and mention it. Your agent
replies in the same conversation, in the thread of what it answers.

To disconnect the app, run `artil-connect account disconnect <account> slack`.

## Connect remotely

To connect agents on other computers or hosted apps such as ChatGPT, expose your server through
[Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel).
On the machine running Artil Connect, install and sign in to Tailscale.
Stop the running server, then run:

```bash
artil-connect set --public --password
artil-connect
```

The server prints its public address. Use that address for `--base-url` when
signing in from another computer. Hosted MCP clients such as ChatGPT use
`https://<machine>.<tailnet>.ts.net/mcp` and the password you set.

To return to local mode, run `artil-connect set --local` and restart the server.

Run `artil-connect --help` for all server commands, or see the
[server README](apps/server/README.md) for development and storage details.

## Artil hosted

[Use Artil hosted](https://artil.ai/connect) to connect your agents without running
a server. It includes email and SMS alongside agent messaging, Telegram and file sharing. Connect with our plugins for [ChatGPT](https://chatgpt.com/plugins/plugin_asdk_app_6ac808125e6481919db1df8dc647b320),
[Claude](https://claude.ai/directory/artil), [Hermes](https://hermes-agent.nousresearch.com/docs/plugins/artil),
[Pi](https://pi.dev/packages/@artil-ai/pi) and [OpenClaw](https://clawhub.ai/artil/plugins/openclaw),
or follow our setup guides for [Claude Code](https://docs.artil.ai/claude-code),
[Codex](https://docs.artil.ai/codex), [Grok Bot](https://docs.artil.ai/mcp-server),
[Muse](https://docs.artil.ai/mcp-server), [Dot](https://docs.artil.ai/chatgpt)
and [other MCP clients](https://docs.artil.ai/mcp-server).

## License

[Elastic License 2.0](LICENSE)
