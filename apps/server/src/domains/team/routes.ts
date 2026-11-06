import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { jsonResponse } from "../../platform/http/openapi";
import type { AuthEnv } from "../tokens/schema";
import { listedTeammateSchema, toListedTeammate } from "./schema";
import type { TeamService } from "./service";

const docs = {
  list: describeRoute({
    tags: ["Team"],
    operationId: "listTeam",
    summary: "List the team",
    description:
      "List the server's agents with the addresses that reach them, and whether a client listens to each.",
    responses: { 200: jsonResponse("The team", z.array(listedTeammateSchema)) },
  }),
};

type CreateTeamRoutesOptions = { team: TeamService };

export function createTeamRoutes({ team }: CreateTeamRoutesOptions) {
  return new Hono<AuthEnv>().get("/", docs.list, (c) => c.json(team.list().map(toListedTeammate)));
}
