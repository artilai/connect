import { AppError } from "@artil/errors";

import { hashPassword, validatePassword } from "../domains/sign-in/password";
import type { ReadSecret } from "../platform/commands";
import { type Config, type Paths, writeConfig } from "../platform/config";

// The flags artil-server set reads, each naming a setting it changes.
export const settingFlags = ["public", "local", "port", "password"];

// What the flags of artil-server set ask for.
type SettingsChange = {
  public: boolean;
  local: boolean;
  port?: string;
  password: boolean;
};

type ChangeSettingsOptions = {
  paths: Paths;
  config: Config;
  change: SettingsChange;
  readSecret: ReadSecret;
  out: (line: string) => void;
};

function invalid(message: string) {
  return new AppError({ code: "invalid_input", message });
}

function readPort(given: string) {
  const port = Number(given);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw invalid(`${given} is not a port`);

  return port;
}

// The hash of a new password for the sign-in page, or undefined when the person stops.
async function readNewPassword(readSecret: ReadSecret) {
  const newPassword = await readSecret({
    message: "A password the sign-in page asks for",
    validate: validatePassword,
  });

  return newPassword ? hashPassword(newPassword) : undefined;
}

// Saves the settings the flags change and says what changed. The sign-in page asks for a new
// password at once, and a new mode or port counts from the server's next start.
export async function changeSettings({
  paths,
  config,
  change,
  readSecret,
  out,
}: ChangeSettingsOptions) {
  if (change.public && change.local) throw invalid("The server is either --public or --local");

  const port = change.port ? readPort(change.port) : config.port;
  const isPublic = change.public || (!change.local && config.public);

  if (isPublic && config.password === null && !change.password) {
    throw invalid("Public mode needs a password for the sign-in page; give --password too");
  }

  let passwordHash = config.password;

  if (change.password) {
    const newPasswordHash = await readNewPassword(readSecret);

    // The person stopped before giving one.
    if (!newPasswordHash) return;

    passwordHash = newPasswordHash;
  }

  const changed = { ...config, public: isPublic, port, password: passwordHash };

  await writeConfig(paths, changed);

  const said: string[] = [];

  if (change.password) said.push("The sign-in page asks for the new password from now on.");

  if (changed.public !== config.public) {
    said.push(
      changed.public
        ? "The server opens to the internet through Tailscale Funnel from its next start."
        : "The server stays on this computer from its next start.",
    );
  }

  if (changed.port !== config.port) {
    said.push(`The server listens on port ${changed.port} from its next start.`);
  }

  out(said.length > 0 ? said.join("\n") : "Nothing changed.");
}
