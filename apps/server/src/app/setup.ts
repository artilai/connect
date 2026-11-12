import {
  type CANCEL_SYMBOL,
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  password,
  select,
  spinner,
  text,
} from "@clack/prompts";

import type { Channel } from "@artil/channels/contract";
import { messageOf } from "@artil/errors";
import { shellQuoted } from "@artil/utils/shell";

import { createAccessCommands } from "../domains/access/commands";
import { signInGuide } from "../domains/accounts/commands";
import { hashPassword, validatePassword } from "../domains/sign-in/password";
import type { ArtilCli } from "../platform/artil-cli";
import { highlightCommands } from "../platform/commands";
import {
  type Config,
  newConfig,
  type Paths,
  type S3Settings,
  writeConfig,
} from "../platform/config";
import { checkStore, createS3Store } from "../platform/storage";
import type { Tailscale } from "../platform/tailscale";
import { type CommandContext, openCommandContext } from "./context";

export class SetupStopped extends Error {
  override name = "SetupStopped";
}

// A prompt the person cancelled stops the setup without saving.
function requireAnswer<Value>(value: Value | typeof CANCEL_SYMBOL): Value {
  if (isCancel(value)) {
    cancel("Setup stopped; nothing more was saved.");
    throw new SetupStopped("Setup stopped");
  }

  return value;
}

function validateNotEmpty(value: string | undefined) {
  return value?.trim() ? undefined : "Fill this in";
}

async function createAccounts(context: CommandContext) {
  const existingAccounts = context.accounts.list();

  if (existingAccounts.length > 0) {
    log.info(`Accounts: ${existingAccounts.map(({ name }) => name).join(", ")}`);
  }

  const namesInput = requireAnswer(
    await text({
      message:
        existingAccounts.length === 0
          ? "Accounts to create, separated by commas"
          : "More accounts to create, if any",
      placeholder: "claude, codex",
      defaultValue: existingAccounts.length === 0 ? "claude, codex" : "",
    }),
  );

  for (const name of namesInput
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    try {
      const account = context.accounts.create(name);

      log.success(`Created ${account.name}`);
    } catch (cause) {
      log.warn(messageOf(cause, `Could not create ${name}`));
    }
  }
}

type SetUpChannelOptions = { context: CommandContext; channel: Channel };

// Offers an address of a channel that takes a token to each account without one, in turn, and lets
// someone wake the agent there.
async function setUpChannel({ context, channel }: SetUpChannelOptions) {
  function accountsWithout() {
    return context.accounts
      .list()
      .filter(
        ({ id }) => !context.addresses.findByAccount({ accountId: id, channel: channel.kind }),
      );
  }

  let connected = false;
  let accounts = accountsWithout();

  while (accounts.length > 0) {
    const connectNow = requireAnswer(
      await confirm({
        message: `Connect ${channel.name} to ${connected ? "another" : "an"} account?`,
        initialValue: false,
      }),
    );

    if (!connectNow) return;

    const accountId = requireAnswer(
      await select({
        message: `Which account connects to ${channel.name}?`,
        options: accounts.map(({ id, name }) => ({ value: id, label: name })),
      }),
    );

    const account = accounts.find(({ id }) => id === accountId);

    if (!account) return;

    const guide = channel.tokenGuide?.(account.name);

    if (guide) context.out(`Connect ${channel.name} to ${account.name}\n${guide}`);

    const answers: string[] = [];

    for (const part of channel.tokenParts ?? [channel.labels.token ?? "token"]) {
      const answer = requireAnswer(
        await password({ message: `${channel.name} ${part}`, validate: validateNotEmpty }),
      );

      answers.push(answer.trim());
    }

    const token = answers.join(" ");

    const progressSpinner = spinner();

    progressSpinner.start(`Connecting ${channel.name}`);

    try {
      const { address } = await context.addresses.connect({
        accountId: account.id,
        kind: channel.kind,
        token: token.trim(),
      });

      progressSpinner.stop(`${address.value} now reaches ${account.name} on ${channel.name}`);
      connected = true;
    } catch (cause) {
      progressSpinner.error(messageOf(cause, `Could not connect ${channel.name}`));

      continue;
    }

    accounts = accountsWithout();

    const sender = requireAnswer(
      await text({
        message: `Who may wake ${account.name} on ${channel.name}? Give a ${channel.name} ${channel.labels.contact}; leave it empty to let them in once they write`,
        defaultValue: "",
      }),
    ).trim();

    if (sender) {
      try {
        const accessCommands = createAccessCommands({
          ...context,
          out: (line) => log.success(line),
        });

        await accessCommands
          .get("account allow")
          ?.run({ account: account.name, who: sender, channel: channel.kind });
      } catch (cause) {
        log.warn(messageOf(cause, `Could not add ${sender}`));
      }
    } else {
      // The list keeps out whoever writes, and in a terminal account allow offers them to let in.
      log.info(
        `Write to ${account.name} on ${channel.name}, then let yourself in with: artil-connect account allow ${shellQuoted(account.name)} --channel ${channel.kind}`,
      );
    }
  }
}

async function askS3Settings(current: S3Settings | null): Promise<S3Settings> {
  const endpoint = requireAnswer(
    await text({
      message: "Endpoint",
      placeholder: "https://<account>.r2.cloudflarestorage.com",
      initialValue: current?.endpoint ?? "",
      validate: (value) =>
        URL.canParse(value?.trim() ?? "") ? undefined : "Give the endpoint's URL",
    }),
  );

  const bucket = requireAnswer(
    await text({
      message: "Bucket",
      initialValue: current?.bucket ?? "",
      validate: validateNotEmpty,
    }),
  );

  const region = requireAnswer(
    await text({
      message: "Region",
      initialValue: current?.region ?? "auto",
      validate: validateNotEmpty,
    }),
  );

  const accessKeyId = requireAnswer(
    await text({
      message: "Access key id",
      initialValue: current?.accessKeyId ?? "",
      validate: validateNotEmpty,
    }),
  );

  const secretAccessKey = requireAnswer(
    await password({ message: "Secret access key", validate: validateNotEmpty }),
  );

  return {
    endpoint: endpoint.trim(),
    bucket: bucket.trim(),
    region: region.trim(),
    accessKeyId: accessKeyId.trim(),
    secretAccessKey: secretAccessKey.trim(),
  };
}

async function setUpFiles(config: Config): Promise<S3Settings | null> {
  const useBucket = requireAnswer(
    await confirm({
      message:
        "Keep the files messages bring in an S3-compatible bucket? Without one, files are off",
      initialValue: config.s3 !== null,
    }),
  );

  if (!useBucket) return null;

  const settings = await askS3Settings(config.s3);
  const progressSpinner = spinner();

  progressSpinner.start("Checking the bucket");

  try {
    await checkStore(createS3Store(settings));
    progressSpinner.stop("The bucket takes files");

    return settings;
  } catch (cause) {
    progressSpinner.error(
      `The bucket did not take a file: ${messageOf(cause, String(cause))}. Files stay off.`,
    );

    return null;
  }
}

type SetUpModeOptions = { config: Config; tailscale?: Tailscale };

// Local or public mode, with the sign-in page's password that public mode needs.
async function setUpMode({ config, tailscale }: SetUpModeOptions) {
  const mode = requireAnswer(
    await select({
      message: "Who reaches this server?",
      initialValue: config.public ? "public" : "local",
      options: [
        { value: "local", label: "Only this computer" },
        {
          value: "public",
          label: "Anyone, through Tailscale Funnel",
          hint: "for ChatGPT and agents on other computers",
        },
      ],
    }),
  );

  if (mode === "local") return { public: false, password: config.password };

  if (!tailscale) {
    log.warn(
      "Tailscale is not installed; install it from https://tailscale.com/download and run setup again. The server stays local.",
    );

    return { public: false, password: config.password };
  }

  try {
    log.info(`The server will be at ${await tailscale.publicUrl()}`);
  } catch (cause) {
    log.warn(`${messageOf(cause, String(cause))}. The server stays local.`);

    return { public: false, password: config.password };
  }

  const keepPassword =
    config.password !== null &&
    requireAnswer(
      await confirm({ message: "Keep the sign-in page's password?", initialValue: true }),
    );

  if (keepPassword) return { public: true, password: config.password };

  const newPassword = requireAnswer(
    await password({
      message: "A password for the sign-in page, which anyone who signs in as an account types",
      validate: validatePassword,
    }),
  );

  return { public: true, password: await hashPassword(newPassword) };
}

// Offers the artil CLI to a computer without it.
async function installArtilCli(artil: ArtilCli) {
  if (artil.installed) return;

  const installNow = requireAnswer(
    await confirm({
      message: "Install the artil CLI, which agents talk through?",
      initialValue: true,
    }),
  );

  if (!installNow) {
    log.info("Install it later with: bun install --global artil-ai");

    return;
  }

  const progressSpinner = spinner();

  progressSpinner.start("Installing the artil CLI");

  try {
    await artil.install();
    progressSpinner.stop("The artil CLI is installed");
  } catch (cause) {
    progressSpinner.error(messageOf(cause, "Could not install the artil CLI"));
    log.info("Install it with: bun install --global artil-ai");
  }
}

type RunSetupOptions = {
  paths: Paths;
  config?: Config;
  builtInChannels: readonly Channel[];
  artil: ArtilCli;
  migrationsFolder: string;
  tailscale?: Tailscale;
  out: (line: string) => void;
};

// Offers the artil CLI, asks for the accounts, their channels' addresses, files and mode, and
// saves the config. The accounts and their addresses go to the database as soon as they are made.
export async function runSetup({
  paths,
  config: savedConfig,
  builtInChannels,
  artil,
  migrationsFolder,
  tailscale,
  out,
}: RunSetupOptions) {
  intro("Artil Connect setup");

  await installArtilCli(artil);

  const config = savedConfig ?? newConfig({ channels: builtInChannels.map(({ kind }) => kind) });

  await writeConfig(paths, config);

  const context = await openCommandContext({
    paths,
    config,
    builtInChannels,
    migrationsFolder,
    tailscale,
    out,
  });

  try {
    await createAccounts(context);

    for (const channel of context.channels.list()) {
      if (channel.connect) await setUpChannel({ context, channel });
    }

    const s3 = await setUpFiles(config);
    const mode = await setUpMode({ config, tailscale });
    const updatedConfig = { ...config, ...mode, s3 };

    await writeConfig(paths, updatedConfig);

    const names = context.accounts.list().map(({ name }) => name);

    const baseUrl =
      updatedConfig.public && tailscale
        ? await tailscale.publicUrl()
        : `http://localhost:${updatedConfig.port}`;

    if (names.length > 0) note(highlightCommands(signInGuide({ baseUrl, names })), "Sign in");

    outro(`Saved to ${paths.config}`);

    return updatedConfig;
  } finally {
    context.close();
  }
}
