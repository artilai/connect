import { Hono, type MiddlewareHandler } from "hono";

import { channel as urlChannel } from "@artil/url-channel";

import { createDraftReader, sendBodyLimit } from "../../platform/http/draft";
import type { FileLinks } from "../files/schema";
import type { AuthEnv } from "../tokens/schema";
import { draftSchema, toMessage } from "./schema";
import type { MessagesService } from "./service";

// A message posted to a Message URL, which itself names whom the message goes to and on what.
const { readDraft, draftForm } = createDraftReader(
  draftSchema.pick({ text: true, thread: true, attachments: true }),
);

type CreateMessageUrlRoutesOptions = {
  messages: MessagesService;
  fileLinks: FileLinks;
  auth: MiddlewareHandler<AuthEnv>;
};

// Accounts' Message URLs, at /a/<id>: what one posts goes to that account on the Message URL, from
// the account whose token posts it, as POST /api/agents/<id>/messages sends it.
export function createMessageUrlRoutes({
  messages,
  fileLinks,
  auth,
}: CreateMessageUrlRoutesOptions) {
  return new Hono<AuthEnv>().post("/:id", auth, sendBodyLimit, readDraft, draftForm, async (c) => {
    const { accountId, accountName } = c.var.actor;
    const { draft, files } = c.req.valid("json");

    const sent = await messages.sendDraft({
      accountId,
      accountName,
      draft: { ...draft, channel: urlChannel.kind, to: [c.req.param("id")] },
      uploads: files,
    });

    return c.json(toMessage(sent, fileLinks), 201);
  });
}
