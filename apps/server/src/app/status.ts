import { messageOf } from "@artil/errors";

import { toRows } from "../platform/commands";
import type { Config } from "../platform/config";
import { findRunningPort } from "../platform/running";
import type { Tailscale } from "../platform/tailscale";
import type { CommandContext } from "./context";
import { runningGreeting } from "./http";

type FindStartProblemsOptions = { config: Config; tailscale: Tailscale | undefined };

type ShowStatusOptions = FindStartProblemsOptions & {
  context: CommandContext;
  out: (line: string) => void;
};

// What keeps the server from starting as its config says.
export function findStartProblems({ config, tailscale }: FindStartProblemsOptions) {
  const problems: string[] = [];

  if (config.public && !tailscale) {
    problems.push(
      "Public mode needs Tailscale: install it from https://tailscale.com/download, or keep the server on this computer with artil-server set --local",
    );
  }

  if (config.public && config.password === null) {
    problems.push(
      "Public mode needs a password for the sign-in page: set one with artil-server set --password",
    );
  }

  return problems;
}

// Whether the server answers on its port, as it does while it runs.
async function isRunning(port: number) {
  try {
    const response = await fetch(`http://localhost:${port}/`, {
      signal: AbortSignal.timeout(1000),
    });

    return (await response.text()).startsWith(runningGreeting);
  } catch {
    return false;
  }
}

// Where the server is, whether it runs, and what keeps it from starting.
export async function showStatus({ config, tailscale, context, out }: ShowStatusOptions) {
  const problems = findStartProblems({ config, tailscale });

  // Tailscale may not give the public address, like when it is signed out.
  const address = await context.baseUrl().catch((cause: unknown) => {
    problems.push(messageOf(cause, String(cause)));

    return `http://localhost:${config.port}`;
  });

  // The port the running server took, which a new one in the config waits for its restart to be.
  const runningPort = (await findRunningPort(context.paths)) ?? config.port;

  const restart =
    runningPort === config.port
      ? ""
      : `, on port ${runningPort} until it restarts on ${config.port}`;

  out(
    [
      "Artil Server",
      ...toRows([
        [
          "Address",
          `${address}, ${config.public ? "public through Tailscale Funnel" : "on this computer"}`,
        ],
        [
          "Running",
          (await isRunning(runningPort)) ? `yes${restart}` : "no; start it with: artil-server",
        ],
      ]),
      ...(problems.length > 0
        ? ["", "Problems:", ...problems.map((problem) => `  ${problem}`)]
        : []),
    ].join("\n"),
  );
}
