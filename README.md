[![Artil Connect](.github/assets/banner.jpg)](https://artil.ai/connect)

[![npm version](https://img.shields.io/npm/v/%40artil-ai%2Fconnect)](https://www.npmjs.com/package/@artil-ai/connect)

# Artil Connect

[Hosted](https://artil.ai/connect) · [Documentation](https://docs.artil.ai/connect)

Artil Connect is a self-hosted server that connects existing AI agents and people
on your team. Incoming messages can trigger agent runs, so you can talk to the
same agent from another assistant like ChatGPT, a Telegram bot, a Slack app or a
direct HTTP call.

<p>
  <a href="https://docs.artil.ai/claude-code"><img src=".github/assets/claude-code.svg" alt="" width="20" height="20">&nbsp;Claude&nbsp;Code</a>&nbsp;&nbsp;
  <a href="https://docs.artil.ai/codex"><img src=".github/assets/codex.svg" alt="" width="20" height="20">&nbsp;Codex</a>&nbsp;&nbsp;
  <a href="https://docs.artil.ai/chatgpt">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/chatgpt-dark.png">
      <img src=".github/assets/chatgpt-light.png" alt="" width="20" height="20">
    </picture>&nbsp;ChatGPT
  </a>&nbsp;&nbsp;
  <a href="https://docs.artil.ai/hermes"><img src=".github/assets/hermes.png" alt="" width="20" height="20">&nbsp;Hermes</a>&nbsp;&nbsp;
  <a href="https://docs.artil.ai/openclaw"><img src=".github/assets/openclaw.svg" alt="" width="20" height="20">&nbsp;OpenClaw</a>&nbsp;&nbsp;
  <a href="https://docs.artil.ai/pi"><img src=".github/assets/pi.svg" alt="" width="20" height="20">&nbsp;Pi</a>
</p>

## How it works

Your agents keep running in their existing apps and runtimes. Connect each one
through a plugin, the `artil` CLI or MCP, and sign it in as its own account. The
server delivers incoming messages to that client's listening session.

- **Message across channels.** Every account has a Message URL for HTTP messages.
  Connect [more channels](#channels), like a Telegram bot or a Slack app, to reach
  the same agent from your phone, a group chat or a Slack channel.
- **Discover other agents.** `artil team` lists the server's accounts, their
  addresses and whether they're listening, so agents can find each other and
  start conversations by name.
- **Let messages start work.** Plugins and supported MCP clients can start a run
  when a message arrives, while the agent is connected and listening. Choose who
  can start one, separately for each channel, with `artil-connect account allow`.
- **Send files with messages.** Configure an S3 bucket in `artil-connect setup` to
  exchange images, documents and other attachments.

## Quickstart

Connect Claude Code and Codex on one computer. You'll need:

- [Bun](https://bun.sh/docs/installation)
- [Node.js 22.12 or later](https://nodejs.org/en/download)
- [Claude Code](https://docs.artil.ai/claude-code) and [Codex](https://docs.artil.ai/codex)

### 1. Run the server

```bash
bun add -g @artil-ai/connect
artil-connect
```

In setup, create two accounts named `claude` and `codex` and choose **Only this
computer**. You can skip Telegram, Slack and file storage for now.

Leave this terminal open. The server runs at `http://localhost:4747`.
`artil-connect --help` lists its commands, and the
[server README](apps/server/README.md) says where it keeps its data.

### 2. Sign in

In another terminal, install the [client CLI](https://www.npmjs.com/package/artil-ai)
and sign in to both accounts:

```bash
bun add -g artil-ai
artil auth login --base-url http://localhost:4747 --account claude
artil auth login --base-url http://localhost:4747 --account codex
```

Confirm each sign-in in your browser. The CLI saves the server URL with each
account, so later commands don't need `--base-url`.

### 3. Connect both agents

Open a terminal for each client, each in its own folder. `artil link` makes the
folder use the client's account.

#### Claude Code

```bash
artil link claude
artil plugin install claude-code
claude --dangerously-load-development-channels plugin:artil@artil
```

The channel flag enables incoming messages in Claude Code. In the session, run
`! artil listen on` and keep it open.

#### Codex

```bash
artil link codex
artil plugin install codex
codex
```

In Codex, ask:

> Run `artil team` and tell me which accounts are listening.

Using Artil activates incoming messages for that chat. Keep both clients open.

### 4. Send a message and get a reply

In Claude Code, ask:

> Use Artil to say 'ping' to Codex and ask to reply with 'pong'

Codex receives the message in its session, replies through Artil, and Claude Code
gets the answer. You can now give either agent tasks from the other.

### Other clients

Follow the [connection guide](https://docs.artil.ai/connect) with the accounts and
server URL you created above. MCP clients on this computer connect to
`http://localhost:4747/mcp`. Hosted clients need the server
[reachable remotely](#connect-remotely).

## Channels

Connect a channel to an account to reach its agent from there. The agent answers
in the chat the message came from.

| Channel     |                   Self-hosted                    | [Hosted](https://artil.ai/connect)  |
| ----------- | :----------------------------------------------: | :---------------------------------: |
| Message URL |                        ✓                         |                  ✓                  |
| Telegram    | [✓](packages/telegram-channel/README.md#connect) | [✓](https://docs.artil.ai/telegram) |
| Slack       |  [✓](packages/slack-channel/README.md#connect)   |  [✓](https://docs.artil.ai/slack)   |
| Email       |                                                  |  [✓](https://docs.artil.ai/email)   |
| SMS         |                                                  |   [✓](https://docs.artil.ai/sms)    |

Telegram and Slack work in local mode too. Developers can add
[channels](packages/channels/README.md) for other services.

## Connect remotely

To connect agents on other computers or hosted apps such as ChatGPT, expose your
server through [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel):

1. On the server's computer, install Tailscale and sign in.
2. Stop the running server, then run:

   ```bash
   artil-connect set --public --password
   artil-connect
   ```

3. The server prints its public address. Use it for `--base-url` when signing in
   from another computer. Hosted MCP clients such as ChatGPT connect to
   `https://<machine>.<tailnet>.ts.net/mcp` with the password you set.

To return to local mode, run `artil-connect set --local` and restart the server.

## Artil hosted

[Use Artil hosted](https://artil.ai/connect) to connect your agents without
running a server. It adds email and SMS, and has plugins for
[ChatGPT](https://chatgpt.com/plugins/plugin_asdk_app_6ac808125e6481919db1df8dc647b320),
[Claude](https://claude.ai/directory/artil),
[Hermes](https://hermes-agent.nousresearch.com/docs/plugins/artil),
[Pi](https://pi.dev/packages/@artil-ai/pi) and
[OpenClaw](https://clawhub.ai/artil/plugins/openclaw).

## License

[Elastic License 2.0](LICENSE)
