import { expect, test } from "bun:test";

import { formatBytes, withQuotes } from "./text";

test("sizes bytes in the unit that keeps them readable", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(999)).toBe("999 B");
  expect(formatBytes(1000)).toBe("1 KB");
  expect(formatBytes(48_213)).toBe("48 KB");
  expect(formatBytes(9_949_999)).toBe("9.9 MB");
  expect(formatBytes(1_500_000_000)).toBe("1.5 GB");
});

test("puts what a message quotes above its text, under who wrote it", () => {
  const quotes = [
    { fromName: "Eve", text: "Deploy failed\non migration 0005" },
    { fromName: null, text: "Build 42 failed" },
  ];

  expect(withQuotes("Can you look?", quotes)).toBe(
    "Eve wrote:\n> Deploy failed\n> on migration 0005\n\n> Build 42 failed\n\nCan you look?",
  );
  expect(withQuotes("", [{ fromName: null, text: "Hi" }])).toBe("> Hi");
  expect(withQuotes("Hi", [])).toBe("Hi");
});
