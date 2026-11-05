import { z } from "zod";

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
