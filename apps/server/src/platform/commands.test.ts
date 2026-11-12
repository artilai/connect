import { expect, test } from "bun:test";
import { styleText } from "node:util";

import { withLinks } from "./commands";

const url = "https://api.slack.com/apps?new_app=1";

const text = `1. [Create the app in Slack](${url})`;

function marked(shown: string) {
  return styleText(["cyan", "underline"], shown);
}

test("shows a link under its label in a terminal that can, and in full after it elsewhere", () => {
  expect(withLinks({ text, hyperlinks: true })).toBe(
    `1. \u001B]8;;${url}\u001B\\${marked("Create the app in Slack ↗")}\u001B]8;;\u001B\\`,
  );
  expect(withLinks({ text, hyperlinks: false })).toBe(`1. Create the app in Slack: ${marked(url)}`);
});
