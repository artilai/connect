import { z } from "zod";

import type { OutboundFile } from "@artil/channels/contract";

import { labelSchema } from "../../platform/http/validate";
import { attachmentsSchema } from "../files/schema";
import { threadSchema } from "../messages/schema";

// The Message URL's kind, as the API and the artil CLI name it.
export const urlKind = "url";

// A message on the Message URL holds up to 2000 characters.
export const maxUrlText = 2000;

type ToMessageUrlOptions = { baseUrl: string; accountId: string };

// An account's Message URL as a person copies it: the short one the server answers beside the API's.
export function toMessageUrl({ baseUrl, accountId }: ToMessageUrlOptions) {
  return `${baseUrl}/a/${accountId}`;
}

// What only the Message URL takes with a message: the thread of the sender's client it comes from,
// the thread of the account's client it is for, and the client the sender writes in. A thread is
// whatever a client calls its conversation, like a Codex thread id.
export type UrlData = {
  thread: string | null;
  toThread: string | null;
  client: string | null;
};

// A message the Message URL hands whole from one account to another, which it names by its id.
export type UrlDelivery = UrlData & {
  from: { id: string; name: string };
  to: string;
  text: string;
  files: OutboundFile[];
};

export const urlMessageSchema = z.object({
  text: z
    .string()
    .trim()
    .max(maxUrlText, `Text must be at most ${maxUrlText} characters`)
    .optional(),
  thread: threadSchema
    .optional()
    .describe("The thread of your client you send from, so the agent can answer there"),
  toThread: threadSchema
    .optional()
    .describe("The thread of the agent's client to hand the message to, from a message it sent"),
  client: labelSchema("A client", 64)
    .optional()
    .describe("The client you send from, like Codex, which the agent sees beside your name"),
  attachments: attachmentsSchema.optional(),
});
