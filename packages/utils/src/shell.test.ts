import { expect, test } from "bun:test";

import { shellQuoted } from "./shell";

test("quotes a value so the shell reads it back unchanged", async () => {
  const value = `it's $HOME; "quoted" \`cmd\``;

  const echoed = await Bun.$`sh -c ${`printf %s ${shellQuoted(value)}`}`.text();

  expect(echoed).toBe(value);
});
