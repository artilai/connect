import { existsSync } from "node:fs";

import { z } from "zod";

export type CommandResult = { code: number; stdout: string; stderr: string };

// Runs the Tailscale CLI with these arguments; the person sees what an interactive one prints.
export type RunTailscale = (args: string[]) => Promise<CommandResult>;

const statusSchema = z.object({
  BackendState: z.string(),
  Self: z.object({ DNSName: z.string() }).optional(),
});

// Funnel takes public traffic on 443 and hands it to the server's local port.
const funnelPort = "443";

class TailscaleError extends Error {
  override name = "TailscaleError";
}

// What a failed command said, for the error that tells of it.
function describeFailure({ code, stdout, stderr }: CommandResult) {
  return stderr.trim() || stdout.trim() || `exit ${code}`;
}

function parseStatus(stdout: string) {
  try {
    return statusSchema.safeParse(JSON.parse(stdout)).data;
  } catch {
    return undefined;
  }
}

type CreateTailscaleOptions = { run: RunTailscale };

export function createTailscale({ run }: CreateTailscaleOptions) {
  // The machine's name in the tailnet, which Funnel serves the server at. Tailscale may warn on
  // stderr, as when the CLI and the app differ in version, so only stdout holds the status.
  async function findHostName() {
    const result = await run(["status", "--json"]);
    const status = result.code === 0 ? parseStatus(result.stdout) : undefined;

    if (!status)
      throw new TailscaleError(`Tailscale could not tell its status: ${describeFailure(result)}`);

    const hostName = status.Self?.DNSName.replace(/\.$/v, "");

    if (status.BackendState !== "Running" || !hostName) {
      throw new TailscaleError("Tailscale is not connected; sign in with: tailscale up");
    }

    return hostName;
  }

  return {
    async publicUrl() {
      return `https://${await findHostName()}`;
    },

    // Opens the server to the internet at the machine's Tailscale name, and returns that address.
    // Funnel then serves only this server on port 443.
    async open(port: number) {
      const publicUrl = `https://${await findHostName()}`;

      const result = await run([
        "funnel",
        "--bg",
        `--https=${funnelPort}`,
        `http://127.0.0.1:${port}`,
      ]);

      if (result.code !== 0) {
        throw new TailscaleError(
          `Tailscale Funnel did not start: ${describeFailure(result)}. Funnel needs MagicDNS and HTTPS certificates on in the tailnet, and on macOS the open-source Tailscale app.`,
        );
      }

      return publicUrl;
    },

    async close() {
      await run(["funnel", `--https=${funnelPort}`, "off"]);
    },
  };
}

export type Tailscale = ReturnType<typeof createTailscale>;

const macApp = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

// The Tailscale CLI on the PATH, or inside the macOS app.
export function findTailscale(platform: string) {
  return (
    Bun.which("tailscale") ?? (platform === "darwin" && existsSync(macApp) ? macApp : undefined)
  );
}

export function runWith(binary: string): RunTailscale {
  return async (args) => {
    const child = Bun.spawn([binary, ...args], {
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    return { code, stdout, stderr };
  };
}
