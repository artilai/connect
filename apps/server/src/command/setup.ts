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

import { type Config, newConfig, type Paths, type S3Settings, writeConfig } from "../config";
import { checkStore, createS3Store } from "../files/store";
import { hashPassword, validatePassword } from "../sign-in/password";
import type { Tailscale } from "../tailscale";
import { addSender } from "./access";
import { connectAddress, signInGuide } from "./agents";
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

async function createAgents(context: CommandContext) {
  const existingAgents = context.agents.list();

  if (existingAgents.length > 0) {
    log.info(`Agents: ${existingAgents.map(({ name }) => name).join(", ")}`);
  }

  const namesInput = requireAnswer(
    await text({
      message:
        existingAgents.length === 0
          ? "Agents to create, separated by commas"
          : "More agents to create, if any",
      placeholder: "claude, codex",
      defaultValue: existingAgents.length === 0 ? "claude, codex" : "",
    }),
  );

  for (const name of namesInput
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    try {
      const agent = context.agents.create(name);

      log.success(`Created ${agent.name}`);
    } catch (cause) {
      log.warn(messageOf(cause, `Could not create ${name}`));
    }
  }
}

type SetUpChannelOptions = { context: CommandContext; channel: Channel };

// Offers to connect an address of a channel that takes credentials, like a Telegram bot, and to
// let someone wake its agent there.
async function setUpChannel({ context, channel }: SetUpChannelOptions) {
  const agents = context.agents.list();

  if (agents.length === 0) return;

  const connectNow = requireAnswer(
    await confirm({
      message: `Connect a ${channel.name} address to an agent?`,
      initialValue: false,
    }),
  );

  if (!connectNow) return;

  const agentId = requireAnswer(
    await select({
      message: `Which agent gets the ${channel.name} address?`,
      options: agents.map(({ id, name }) => ({ value: id, label: name })),
    }),
  );

  const agent = agents.find(({ id }) => id === agentId);

  if (!agent) return;

  const credentials = requireAnswer(
    await password({ message: channel.credentials ?? "Credentials", validate: validateNotEmpty }),
  );

  const progressSpinner = spinner();

  progressSpinner.start(`Connecting the ${channel.name} address`);

  try {
    await connectAddress({
      context: { ...context, out: () => {} },
      kind: channel.kind,
      name: agent.name,
      credentials: credentials.trim(),
    });
    progressSpinner.stop(`The address reaches ${agent.name}`);
  } catch (cause) {
    progressSpinner.error(messageOf(cause, `Could not connect the ${channel.name} address`));

    return;
  }

  const sender = requireAnswer(
    await text({
      message: `Who may wake ${agent.name} on ${channel.name}? ${channel.senders?.description ?? "A sender"}; leave it empty for only the server's agents`,
      defaultValue: "",
    }),
  ).trim();

  if (sender) {
    try {
      addSender({
        context: { ...context, out: (line) => log.success(line) },
        name: agent.name,
        kind: channel.kind,
        sender,
      });
    } catch (cause) {
      log.warn(messageOf(cause, `Could not add ${sender}`));
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

type SetUpModeOptions = { config: Config; tailscale: Tailscale | undefined };

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
      message: "A password for the sign-in page, which anyone who signs an agent in types",
      validate: validatePassword,
    }),
  );

  return { public: true, password: await hashPassword(newPassword) };
}

type RunSetupOptions = {
  paths: Paths;
  config: Config | undefined;
  migrationsFolder: string;
  tailscale: Tailscale | undefined;
  out: (line: string) => void;
};

// Asks for the agents, their channels' addresses, files and mode, and saves the config. The
// agents and their addresses go to the database as soon as they are made.
export async function runSetup({
  paths,
  config: savedConfig,
  migrationsFolder,
  tailscale,
  out,
}: RunSetupOptions) {
  intro("Artil server setup");

  const config = savedConfig ?? newConfig();

  await writeConfig(paths, config);

  const context = await openCommandContext({ paths, config, migrationsFolder, tailscale, out });

  try {
    await createAgents(context);

    for (const channel of context.channels.values()) {
      if (channel.connect) await setUpChannel({ context, channel });
    }

    const s3 = await setUpFiles(config);
    const mode = await setUpMode({ config, tailscale });
    const updatedConfig = { ...config, ...mode, s3 };

    await writeConfig(paths, updatedConfig);

    const names = context.agents.list().map(({ name }) => name);

    const baseUrl =
      updatedConfig.public && tailscale
        ? await tailscale.publicUrl()
        : `http://localhost:${updatedConfig.port}`;

    if (names.length > 0) note(signInGuide({ baseUrl, names }), "Sign in");

    outro(`Saved to ${paths.config}`);

    return updatedConfig;
  } finally {
    context.close();
  }
}
