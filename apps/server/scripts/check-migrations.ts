import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { $ } from "bun";

// The migrations must hold together, and cover every change to the schema.
const root = new URL("..", import.meta.url).pathname;

const checked = await $`bun drizzle-kit check`.cwd(root).nothrow().quiet();

if (checked.exitCode !== 0 || checked.text().includes("Warning:")) {
  console.error(checked.text(), checked.stderr.toString());
  process.exit(1);
}

// drizzle-kit reads its output folder relative to the package.
const copy = "node_modules/.cache/migrations-check";

await rm(join(root, copy), { recursive: true, force: true });

await mkdir(join(root, copy), { recursive: true });

try {
  await cp(join(root, "migrations"), join(root, copy), { recursive: true });

  const generated =
    await $`bun drizzle-kit generate --dialect sqlite --schema ./src/db/schema.ts --out ./${copy}`
      .cwd(root)
      .nothrow()
      .quiet();

  if (!generated.text().includes("No schema changes")) {
    console.error(generated.text(), generated.stderr.toString());
    console.error(
      "The schema has changes no migration covers. Run `bun run db:generate --name <snake_case_summary>` and commit what it writes.",
    );
    process.exit(1);
  }
} finally {
  await rm(join(root, copy), { recursive: true, force: true });
}
