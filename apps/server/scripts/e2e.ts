import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { channel as telegramChannel } from "@artil/telegram-channel";

import { startServer } from "../src/app/server";
import { loadChannels } from "../src/domains/channels/load";
import { newConfig } from "../src/platform/config";

// Runs the published artil CLI against the server, the way a person sets up two accounts on one
// computer: both sign in with a token, one listens, and the other writes to its Message URL.
const artil = process.argv[2] ?? Bun.which("artil");

if (!artil) throw new Error("Give the artil CLI's path, or put artil on the PATH");

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

const folder = await mkdtemp(join(tmpdir(), "artil-server-e2e-"));

const config = { ...newConfig({ channels: [telegramChannel.kind] }), port: 0 };

const server = await startServer({
  config,
  databasePath: join(folder, "artil.db"),
  migrationsFolder,
  channels: await loadChannels({
    specifiers: config.channels,
    dataDir: folder,
    builtInChannels: [telegramChannel],
  }),
  password: async () => null,
  log: (line) => console.log(`server: ${line}`),
});

type RunOptions = { account: string; args: string[] };

function environment(account: string) {
  return {
    ...process.env,
    ARTIL_CONFIG_HOME: join(folder, account),
    ARTIL_BASE_URL: server.baseUrl,
    ARTIL_ACCOUNT: "",
    ARTIL_TOKEN: "",
  };
}

async function run({ account, args }: RunOptions) {
  const child = Bun.spawn([artil ?? "artil", ...args], {
    env: environment(account),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (code !== 0) throw new Error(`artil ${args.join(" ")} failed:\n${stdout}${stderr}`);

  return stdout;
}

function within<T>(seconds: number, work: Promise<T>) {
  const { promise, reject } = Promise.withResolvers<never>();

  const timer = setTimeout(
    () => reject(new Error(`Nothing happened within ${seconds} seconds`)),
    seconds * 1000,
  );

  return Promise.race([work, promise]).finally(() => clearTimeout(timer));
}

try {
  for (const name of ["claude", "codex"]) {
    const account = server.services.accounts.create(name);
    const token = server.services.tokens.issue({ accountId: account.id, name: "e2e" });

    await run({ account: name, args: ["auth", "login", "--token", token] });
  }

  await run({ account: "codex", args: ["listen", "on", "--client", "pi"] });

  // The Pi channel prints each new message as a JSON line, for as long as its input stays open.
  const channel = Bun.spawn([artil, "internal", "pi-channel"], {
    env: environment("codex"),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });

  try {
    await within(
      20,
      (async () => {
        while (
          !server.services.connections.isListening(
            server.services.accounts.findByIdOrName("codex")?.id ?? "",
          )
        ) {
          await Bun.sleep(200);
        }
      })(),
    );

    await run({ account: "claude", args: ["url", "send", "codex", "--", "Review the release"] });

    const reader = channel.stdout.pipeThrough(new TextDecoderStream()).getReader();

    const heard = await within(
      20,
      (async () => {
        let text = "";

        while (!text.includes("Review the release")) {
          const chunk = await reader.read();

          if (chunk.done) throw new Error(`The channel ended: ${text}`);

          text += chunk.value;
        }

        return text;
      })(),
    );

    if (!heard.includes("From: claude"))
      throw new Error(`Codex heard the message without its sender: ${heard}`);

    const team = await run({ account: "claude", args: ["team", "--json"] });

    if (!team.includes('"listening": true') && !team.includes('"listening":true')) {
      throw new Error(`The team does not show Codex listening: ${team}`);
    }

    console.log(
      "The artil CLI signed in as two accounts, and one heard the other at its Message URL.",
    );
  } finally {
    channel.kill();
  }
} finally {
  await server.stop();
  await rm(folder, { recursive: true, force: true });
}
