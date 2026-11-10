import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

const defaultPort = 4747;

const s3Schema = z.object({
  endpoint: z.url(),
  bucket: z.string().min(1),
  region: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
});

export type S3Settings = z.infer<typeof s3Schema>;

const configSchema = z.object({
  version: z.literal(1),
  port: z.int().min(1).max(65_535),
  // Whether Tailscale Funnel opens the server to the internet.
  public: z.boolean(),
  // The hash of the password the sign-in page asks for, which public mode needs.
  password: z.string().nullable(),
  // Signs file links and channels' webhooks, so only this server makes ones it accepts, and makes
  // the key the server encrypts messages, bots' tokens and files with: without it they are lost.
  secret: z.string().min(32),
  // The ids clients written for Artil Cloud expect of a workspace and of whoever signed them in.
  workspaceId: z.uuid(),
  ownerId: z.uuid(),
  s3: s3Schema.nullable(),
  // The channels the server loads beside the Message URL: one it comes with by its kind, or a
  // module that exports a channel definition, by its path or its package name, which the server
  // finds from the data folder.
  channels: z.array(z.string().min(1)),
});

export type Config = z.infer<typeof configSchema>;

type NewConfigOptions = { channels: readonly string[] };

// A new server loads every channel it comes with.
export function newConfig({ channels }: NewConfigOptions): Config {
  return {
    version: 1,
    port: defaultPort,
    public: false,
    password: null,
    secret: randomBytes(32).toString("base64url"),
    workspaceId: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
    s3: null,
    channels: [...channels],
  };
}

export function pathsIn(dataDir: string) {
  return {
    dataDir,
    config: join(dataDir, "config.json"),
    database: join(dataDir, "artil.db"),
    // The port the running server took, which artil-server status reads.
    running: join(dataDir, "running.json"),
  };
}

export type Paths = ReturnType<typeof pathsIn>;

export async function readConfig(paths: Paths) {
  const text = await readFile(paths.config, "utf8").catch((cause: unknown) => {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;

    throw cause;
  });

  if (text === undefined) return undefined;

  const parsed = configSchema.safeParse(JSON.parse(text));

  if (!parsed.success) {
    throw new Error(`${paths.config} is not a config this server reads: ${parsed.error.message}`);
  }

  return parsed.data;
}

// The folder and the config hold the server's secrets, so only their owner reads them. The config
// goes in whole or not at all.
export async function writeConfig(paths: Paths, config: Config) {
  await mkdir(paths.dataDir, { recursive: true, mode: 0o700 });
  await chmod(paths.dataDir, 0o700);

  const draft = `${paths.config}.${process.pid}.tmp`;

  await writeFile(draft, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(draft, paths.config);
}
