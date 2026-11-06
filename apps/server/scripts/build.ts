import { cp, rm } from "node:fs/promises";

import manifest from "../package.json";

// dist is the package npm publishes: one bundle Bun runs, with the migrations beside it and a
// manifest that names no workspace packages, since the bundle holds them.
const root = new URL("..", import.meta.url).pathname;

const dist = `${root}dist`;

await rm(dist, { recursive: true, force: true });

const built = await Bun.build({
  entrypoints: [`${root}src/main.ts`],
  target: "bun",
  outdir: `${dist}/bin`,
  sourcemap: "linked",
});

if (!built.success) {
  for (const log of built.logs) console.error(log);

  process.exit(1);
}

await cp(`${root}migrations`, `${dist}/migrations`, { recursive: true });

await cp(`${root}README.md`, `${dist}/README.md`);

await cp(`${root}../../LICENSE`, `${dist}/LICENSE`);

const published = {
  name: manifest.name,
  version: manifest.version,
  description: manifest.description,
  license: manifest.license,
  homepage: manifest.homepage,
  repository: manifest.repository,
  type: "module",
  bin: { "artil-server": "bin/main.js" },
  files: ["bin", "migrations"],
  engines: { bun: ">=1.3.14" },
  publishConfig: { access: "public", provenance: true },
};

await Bun.write(`${dist}/package.json`, `${JSON.stringify(published, null, 2)}\n`);
