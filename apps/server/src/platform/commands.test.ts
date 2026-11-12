import { expect, test } from "bun:test";

import { withLinks } from "./commands";

const text = "1. [Create the app in Slack](https://api.slack.com/apps?new_app=1)";

test("shows a link under its label in a terminal that can, and in full after it elsewhere", () => {
  expect(withLinks({ text, hyperlinks: true })).toBe(
    "1. \u001B]8;;https://api.slack.com/apps?new_app=1\u001B\\Create the app in Slack\u001B]8;;\u001B\\",
  );
  expect(withLinks({ text, hyperlinks: false })).toBe(
    "1. Create the app in Slack: https://api.slack.com/apps?new_app=1",
  );
});
