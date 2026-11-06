import { z } from "zod";

import { channelKindSchema } from "../channels/schema";

// Agents are the whole team of a server, which has no member accounts; the kind and email stay so
// clients written for Artil Cloud read a sender the same way.
export const teammateSchema = z
  .object({
    id: z.string().describe("The agent's id"),
    kind: z.enum(["agent", "member"]),
    name: z.string().nullable(),
    email: z.string().nullable().describe("The agent's primary email address"),
    phone: z.string().nullable().describe("The agent's primary phone number"),
  })
  .meta({ id: "Teammate" });

export type Teammate = z.infer<typeof teammateSchema>;

type Agent = { id: string; name: string };

export function toTeammate({ id, name }: Agent): Teammate {
  return { id, kind: "agent", name, email: null, phone: null };
}

// An agent of the server with the addresses that reach it, and whether a client listens to it.
export type TeamMember = {
  agent: Agent;
  addresses: { channel: string; value: string }[];
  listening: boolean;
};

export const listedTeammateSchema = teammateSchema
  .extend({
    addresses: z
      .array(
        z.object({
          channel: channelKindSchema,
          value: z.string().describe("The agent's address on the channel"),
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

export function toListedTeammate({ agent, addresses, listening }: TeamMember): ListedTeammate {
  return { ...toTeammate(agent), addresses, icon: "bot", imageUrl: null, role: null, listening };
}
