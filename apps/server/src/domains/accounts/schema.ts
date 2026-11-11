import { z } from "zod";

import type { accounts } from "../../platform/db/schema";
import type { AuthEnv } from "../tokens/schema";

export type AccountRecord = typeof accounts.$inferSelect;

// The routes of one account hold it, once its own token signed in.
export type AccountEnv = { Variables: AuthEnv["Variables"] & { account: AccountRecord } };

export const accountSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    icon: z.enum(["bot"]),
    createdAt: z.date(),
  })
  .meta({ id: "Agent" });

type Account = z.infer<typeof accountSchema>;

export function toAccount({ id, name, createdAt }: AccountRecord): Account {
  return { id, name, icon: "bot", createdAt };
}

type ToMessageUrlOptions = { baseUrl: string; accountId: string };

// An account's Message URL as a person copies it, which the server answers at /a/<id>.
export function toMessageUrl({ baseUrl, accountId }: ToMessageUrlOptions) {
  return `${baseUrl}/a/${accountId}`;
}
