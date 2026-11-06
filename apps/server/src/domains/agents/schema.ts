import { z } from "zod";

import type { agents } from "../../platform/db/schema";
import type { AuthEnv } from "../tokens/schema";

export type AgentRecord = typeof agents.$inferSelect;

// The routes of one agent hold it, once its own token signed in.
export type AgentEnv = { Variables: AuthEnv["Variables"] & { agent: AgentRecord } };

export const agentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    icon: z.enum(["bot"]),
    createdAt: z.date(),
  })
  .meta({ id: "Agent" });

type Agent = z.infer<typeof agentSchema>;

export function toAgent({ id, name, createdAt }: AgentRecord): Agent {
  return { id, name, icon: "bot", createdAt };
}
