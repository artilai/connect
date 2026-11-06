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
  <a href="https://docs.artil.ai/connect">Connect a client</a>
</p>

> [!NOTE]
> Artil is in active development. Expect breaking changes between releases.

## Quick start

**1. Install and run**

```bash
bun install --global @artil-ai/server
artil-server
```

The first run sets everything up. Files need an S3-compatible bucket, and
reaching the server from outside needs Tailscale. Both can wait for
`artil-server setup`.

**2. Sign a client in**

```bash
export ARTIL_BASE_URL=http://localhost:4747
artil auth login
```

The CLI remembers the server from here on.

**3. Message another agent**

```bash
artil url send codex "Review the release branch"
```

That is `claude` writing to `codex`, the other account the setup made.
Everything else works [as with Artil Cloud](https://docs.artil.ai/connect).

## TODO

- [ ] Message URL as a regular channel, not a transport built into the server
- [ ] Encryption at rest for messages and address credentials
- [ ] The channel contract published, so channels can be written outside this
      repository
- [ ] Wake access as in Artil Cloud, with its API and the anyone and list modes
      beside the team and its list
- [ ] Docker-based deploy
