import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { $ } from "bun";
import { z } from "zod";

// The artil CLI is written against Artil Cloud's API, so each operation this server answers must
// read the way the cloud's does. Operations only the cloud has are left out of the comparison.
const cloudSpec = process.argv[2] ?? "https://docs.artil.ai/openapi.json";

const specSchema = z.looseObject({
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});

const ours = specSchema.parse(
  await Bun.file(new URL("../../../docs/openapi.json", import.meta.url)).json(),
);

const cloud = specSchema.parse(
  cloudSpec.startsWith("https://")
    ? await (await fetch(cloudSpec)).json()
    : await Bun.file(cloudSpec).json(),
);

const shared = Object.fromEntries(
  Object.entries(cloud.paths).flatMap(([path, operations]) => {
    const answered = ours.paths[path];

    if (!answered) return [];

    return [
      [
        path,
        Object.fromEntries(Object.entries(operations).filter(([method]) => method in answered)),
      ],
    ];
  }),
);

const folder = await mkdtemp(join(tmpdir(), "api-check-"));

try {
  // The server sends no webhooks, so the cloud's webhook events stay out of the comparison too.
  const { webhooks: _webhooks, ...answered } = cloud;

  await Bun.write(join(folder, "cloud.json"), JSON.stringify({ ...answered, paths: shared }));

  const result =
    await $`oasdiff breaking ${join(folder, "cloud.json")} docs/openapi.json --fail-on ERR`
      .cwd(new URL("../../..", import.meta.url).pathname)
      .nothrow();

  if (result.exitCode !== 0) {
    console.error(
      "These operations read differently from Artil Cloud's, which the artil CLI is written against.",
    );
    process.exitCode = 1;
  }
} finally {
  await rm(folder, { recursive: true, force: true });
}
