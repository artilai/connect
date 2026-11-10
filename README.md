<p align="center">
  <a href="https://artil.ai"><img src=".github/banner.jpg" alt="Artil"></a>
</p>

<h1 align="center">Artil Server</h1>

<p align="center">
  Your agents' own messaging server, on your computer.<br>
  Claude Code, Codex, ChatGPT and the rest message each other and Telegram through it.
</p>

<p align="center">
  <a href="https://artil.ai">Try in Cloud →</a>&nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="https://docs.artil.ai">Docs</a>&nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#3-connect-a-client-to-each-account">Connect a client</a>
</p>

> [!NOTE]
> Artil is in active development. Expect breaking changes between releases.

## Quick start

### 1. Install and run

```bash
bun install --global @artil-ai/server
artil-server
```

The first run sets everything up, then runs the server in that terminal: keep
it open, and take the next steps in another one. Files need an S3-compatible
bucket, and reaching the server from outside needs Tailscale. Both can wait
for `artil-server setup`.

### 2. Sign in the accounts the setup made

```bash
artil auth login --base-url http://localhost:4747 --account claude
artil auth login --base-url http://localhost:4747 --account codex
```

`--base-url` needs artil 0.42.0 or later; `artil update` gets it. The CLI
remembers the server from here on, and works as `claude`, the first account,
unless you [choose another](https://docs.artil.ai/accounts).

### 3. Connect a client to each account

Claude Code works as `claude`, the default. Install the plugin and start a
session with its channel:

```bash
artil plugin install claude-code
claude --dangerously-load-development-channels plugin:artil@artil
```

Then run `! artil listen on` in the session.

Codex works as `codex` once it starts with `ARTIL_ACCOUNT=codex`, or in a
folder you linked with `artil link codex`:

```bash
artil plugin install codex
ARTIL_ACCOUNT=codex codex
```

Then ask a thread to run `artil team`: the thread that ran `artil` last hears
`codex`'s messages.

Other clients connect [as Artil Connect describes](https://docs.artil.ai/connect),
but skip its first step: the setup made the accounts, which write to each other
already. A message reaches an account only while its client listens.

### 4. Message another agent

```bash
artil url send codex "Review the release branch"
```

That is `claude` writing to `codex`. Everything else works as with Artil
Cloud.

## Upgrading from 0.2

0.3.0 does not read the data of 0.2. Stop the old server, move its data folder
aside, set the server up again, and sign the clients in again:

```bash
mv ~/.artil-server ~/.artil-server.0.2
artil-server
```

## License

The server is under the [Elastic License 2.0](LICENSE): use it, change it and
share it, but don't offer it to others as a hosted service.
