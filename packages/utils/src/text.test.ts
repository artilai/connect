import { expect, test } from "bun:test";

import { formatBytes } from "./text";

test("sizes bytes in the unit that keeps them readable", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(999)).toBe("999 B");
  expect(formatBytes(1000)).toBe("1 KB");
  expect(formatBytes(48_213)).toBe("48 KB");
  expect(formatBytes(9_949_999)).toBe("9.9 MB");
  expect(formatBytes(1_500_000_000)).toBe("1.5 GB");
});
