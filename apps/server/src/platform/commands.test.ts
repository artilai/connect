import { expect, test } from "bun:test";

import { withLinks } from "./commands";

const url = "https://api.slack.com/apps?new_app=1";

// Tests run outside a terminal, which shows a link in full after its label.
test("shows a link in full after its label where the terminal cannot show it under it", () => {
  expect(Bun.stripANSI(withLinks(`1. [Create the app in Slack](${url})`))).toBe(
    `1. Create the app in Slack: ${url}`,
  );
});
