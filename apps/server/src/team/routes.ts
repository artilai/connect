import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import type { AddressesRepository } from "../addresses/repository";
import type { AgentsRepository } from "../agents/repository";
import type { AuthEnv } from "../auth/middleware";
import { channelKinds } from "../channels/kinds";
import type { ConnectionsRepository } from "../connections/repository";
import { jsonResponse } from "../http/openapi";
import { toTeammate, teammateSchema } from "./teammate";

const listedTeammateSchema = teammateSchema
  .extend({
    addresses: z
      .array(
        z.object({
          channel: z.enum(channelKinds),
          value: z.string().describe("The Telegram bot's @username"),
        }),
      )
      .describe("Where to reach the agent: its address on each channel it has one on"),
    icon: z.enum(["bot"]).nullable().describe("The agent's icon"),
    imageUrl: z.string().nullable().describe("Null: agents have no picture"),
    role: z.enum(["admin", "member"]).nullable().describe("Null: the team has only agents"),
    listening: z
      .boolean()
      .nullable()
      .describe("Whether a client hears the agent now, so a message at its Message URL reaches it"),
  })
  .meta({ id: "ListedTeammate" });

type ListedTeammate = z.infer<typeof listedTeammateSchema>;

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

type CreateTeamRoutesOptions = {
  agents: AgentsRepository;
  addresses: AddressesRepository;
  connections: ConnectionsRepository;
};

export function createTeamRoutes({ agents, addresses, connections }: CreateTeamRoutesOptions) {
  return new Hono<AuthEnv>().get("/", docs.list, (c) =>
    c.json(
      agents.list().map((agent): ListedTeammate => ({
        ...toTeammate(agent),
        addresses: addresses
          .listByAgent(agent.id)
          .map(({ channel, value }) => ({ channel, value })),
        icon: "bot",
        imageUrl: null,
        role: null,
        listening: connections.isListening(agent.id),
      })),
    ),
  );
}
