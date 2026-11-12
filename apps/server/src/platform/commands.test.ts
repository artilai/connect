import { expect, test } from "bun:test";

import { withLinks } from "./commands";

const url = "https://api.slack.com/apps?new_app=1";

const text = `1. [Create the app in Slack](${url})`;

test("shows a link under its label in a terminal that can, and in full after it elsewhere", () => {
  const underLabel = withLinks({ text, hyperlinks: true });
  const inFull = Bun.stripANSI(withLinks({ text, hyperlinks: false }));

  expect(underLabel).toStartWith(`1. \u001B]8;;${url}\u001B\\`);
  expect(underLabel).toContain("Create the app in Slack ↗");
  expect(inFull).toBe(`1. Create the app in Slack: ${url}`);
});
