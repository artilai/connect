import { $ } from "bun";

// The artil CLI on this computer, which the agents' clients talk through.
export type ArtilCli = {
  installed: boolean;
  // Installs it for whoever uses this computer's Bun.
  install: () => Promise<void>;
};

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
