import type { McpServer } from "@modelcontextprotocol/server";

import { readOnlyHints, type RunTool, withTitle } from "../../platform/mcp";
import { toTeammate } from "./schema";
import type { TeamService } from "./service";

type RegisterTeamToolsOptions = { server: McpServer; runTool: RunTool; team: TeamService };

export function registerTeamTools({ server, runTool, team }: RegisterTeamToolsOptions) {
  server.registerTool(
    "team.list",
    {
      ...withTitle("List the team", readOnlyHints),
      description:
        "List the server's agent accounts with their ids and addresses, and whether a client listens to each for its messages.",
    },
    () =>
      runTool(() =>
        team.list().map(({ account, addresses, listening }) => ({
          ...toTeammate(account),
          addresses,
          listening,
        })),
      ),
  );
}
