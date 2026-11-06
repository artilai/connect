import type { UrlChannelHost } from "@artil/url-channel/channel";

import { describeRefusal } from "../access/schema";
import type { AccessService } from "../access/service";
import type { AgentsService } from "../agents/service";
import type { ConnectionsService } from "../connections/service";
import type { EventsService } from "../events/service";
import type { FilesService } from "../files/service";

type CreateUrlHostOptions = {
  agents: AgentsService;
  access: AccessService;
  connections: ConnectionsService;
  events: EventsService;
  files: FilesService;
};

// What the server does for the Message URL, which it carries itself: the channel's rules stay in
// its package, and the server decides by the agent's list, keeps the files and hands the message
// to the agent's event stream.
export function createUrlHost({
  agents,
  access,
  connections,
  events,
  files,
}: CreateUrlHostOptions): UrlChannelHost {
  return {
    findAgent: async (id) => agents.findById(id),

    async admit({ agentId, senderId, listed }) {
      const { refusal } = access.decide({
        agentId,
        channel: "url",
        from: senderId,
        handle: null,
        fromSelf: false,
        spam: false,
        // Only the server's agents write on the Message URL.
        fromTeam: true,
        fromVerified: true,
        listed,
      });

      return refusal && { code: refusal, reason: describeRefusal(refusal) };
    },

    isListening: async (agentId) => connections.isListening(agentId),

    async handOver({ from, to, text, files: uploads, thread, toThread, client, filesExpireAt }) {
      if (uploads.length > 0 && !files.enabled) throw files.unavailableError();

      const messageId = crypto.randomUUID();

      // The files go in before the event, so the agent never hears of a message without them.
      await files.save({ agentId: to.id, messageId, uploads, expiresAt: filesExpireAt });

      events.add({
        agentId: to.id,
        event: {
          type: "message.received",
          channel: "url",
          messageId,
          text,
          sender: { id: from.id, name: from.name },
          thread,
          toThread,
          client,
        },
      });

      return messageId;
    },
  };
}
