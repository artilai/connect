import { expect, test } from "bun:test";

import { type CommandResult, createTailscale } from "./tailscale";

type Answers = Record<string, CommandResult>;

function fake(answers: Answers) {
  const ran: string[][] = [];

  const tailscale = createTailscale({
    run: async (args) => {
      ran.push(args);

      return answers[args[0] ?? ""] ?? { code: 0, stdout: "", stderr: "" };
    },
  });

  return { tailscale, ran };
}

const running = {
  code: 0,
  stdout: JSON.stringify({ BackendState: "Running", Self: { DNSName: "mac.tailnet.ts.net." } }),
  // The CLI warns here when it and the app differ in version.
  stderr: "Warning: client version differs from tailscaled version\n",
};

test("opens the server at the machine's Tailscale name and closes it again", async () => {
  const { tailscale, ran } = fake({ status: running });

  expect(await tailscale.open(4747)).toBe("https://mac.tailnet.ts.net");

  await tailscale.close();

  expect(ran).toEqual([
    ["status", "--json"],
    ["funnel", "--bg", "--https=443", "http://127.0.0.1:4747"],
    ["funnel", "--https=443", "off"],
  ]);
});

test("asks to sign in to Tailscale when it is not connected", async () => {
  const { tailscale } = fake({
    status: { code: 0, stdout: JSON.stringify({ BackendState: "NeedsLogin" }), stderr: "" },
  });

  await expect(tailscale.publicUrl()).rejects.toThrow(
    "Tailscale is not connected; sign in with: tailscale up",
  );
});

test("says what Funnel needs when it does not start", async () => {
  const { tailscale } = fake({
    status: running,
    funnel: { code: 1, stdout: "", stderr: "Funnel not available; HTTPS must be enabled.\n" },
  });

  await expect(tailscale.open(4747)).rejects.toThrow(
    /Tailscale Funnel did not start: Funnel not available; HTTPS must be enabled\..+MagicDNS/v,
  );
});
