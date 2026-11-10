import type { McpServer } from "@modelcontextprotocol/server";

import { readOnlyHints, type RunTool, withTitle } from "../../platform/mcp";
import type { AddressesService } from "../addresses/service";
import type { Actor } from "../tokens/schema";

type RegisterMeToolsOptions = {
  server: McpServer;
  actor: Actor;
  runTool: RunTool;
  addresses: AddressesService;
};

export function registerMeTools({ server, actor, runTool, addresses }: RegisterMeToolsOptions) {
  server.registerTool(
    "status",
    {
      ...withTitle("Show the agent account", readOnlyHints),
      description:
        "Show the agent account these tools act as, with the addresses people reach it at.",
    },
    () =>
      runTool(() => ({
        agent: { id: actor.accountId, name: actor.accountName },
        addresses: addresses
          .listByAccount(actor.accountId)
          .map(({ channel, value }) => ({ channel, value, primary: true })),
        signedInBy: null,
      })),
  );
}
