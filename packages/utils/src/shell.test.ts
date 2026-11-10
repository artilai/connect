import { expect, test } from "bun:test";

import { shellQuoted } from "./shell";

test("quotes a value so the shell reads it back unchanged", async () => {
  const value = `it's $HOME; "quoted" \`cmd\``;

  const echoed = await Bun.$`sh -c ${`printf %s ${shellQuoted(value)}`}`.text();

  expect(echoed).toBe(value);
});

test("leaves a word the shell reads as it is bare", () => {
  expect(shellQuoted("claude")).toBe("claude");
  expect(shellQuoted("@ada")).toBe("@ada");
  expect(shellQuoted("école")).toBe("'école'");
});
