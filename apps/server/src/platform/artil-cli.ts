import { $ } from "bun";

// The artil CLI on this computer, which agents talk through.
export type ArtilCli = {
  installed: boolean;
  // Installs it for whoever uses this computer's Bun.
  install: () => Promise<void>;
};

// The command that signs the artil CLI in to this server. --base-url needs artil 0.42.0 or newer.
export function loginCommand(baseUrl: string) {
  return `artil auth login --base-url ${baseUrl}`;
}

export function findArtilCli(): ArtilCli {
  return {
    installed: Bun.which("artil") !== null,

    async install() {
      const installed = await $`bun install --global artil-ai`.nothrow().quiet();

      if (installed.exitCode !== 0) {
        throw new Error(
          installed.stderr.toString().trim() || `bun install exited with ${installed.exitCode}`,
        );
      }
    },
  };
}
