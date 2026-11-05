import type { Channel } from "@artil/channels/contract";
import type { UrlData } from "@artil/url-channel/channel";

import type { EventsRepository } from "../events/repository";
import { type AttachmentInput, readAttachments } from "../files/outgoing";
import type { FilesService, Upload } from "../files/service";

type CreateUrlRelayOptions = {
  channel: Channel<"url", UrlData>;
  events: EventsRepository;
  files: FilesService;
};

type RelayOptions = {
  sender: { id: string; name: string };
  // The one agent the message goes to, which the channel checks.
  to: string[];
  cc: string[];
  text: string;
  thread: string | null;
  toThread: string | null;
  // The client the sender writes in.
  client: string | null;
  // Files the sender has or wrote for the message, and ones uploaded with it.
  attachments: readonly AttachmentInput[];
  uploads: readonly Upload[];
};

// Sends a message on the Message URL for the API and MCP, and returns the event the agent got.
export function createUrlRelay({ channel, events, files }: CreateUrlRelayOptions) {
  return async function relay({
    sender,
    to,
    cc,
    text,
    thread,
    toThread,
    client,
    attachments,
    uploads,
  }: RelayOptions) {
    const attachedFiles = await readAttachments({ files, agentId: sender.id, attachments });

    const { externalId: messageId } = await channel.send({
      from: sender.id,
      fromName: sender.name,
      credentials: null,
      to,
      cc,
      subject: null,
      text,
      // The server keeps the bytes itself, so the files need no links.
      files: [...attachedFiles, ...uploads].map((file) => ({ ...file, url: "" })),
      inReplyTo: null,
      channelData: { thread, toThread, client },
    });

    // The channel took the message for exactly one agent.
    const [agentId = ""] = to;
    const event = events.findRelay({ agentId, messageId });

    if (!event) throw new Error(`Message ${messageId} went missing`);

    return event;
  };
}

export type RelayToUrl = ReturnType<typeof createUrlRelay>;
