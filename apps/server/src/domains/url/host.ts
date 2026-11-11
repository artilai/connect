import type { UrlChannelHost } from "@artil/url-channel/channel";

import { describeRefusal } from "../access/schema";
import type { AccessService } from "../access/service";
import type { AgentsService } from "../agents/service";
import type { ConnectionsService } from "../connections/service";
import type { ReceiveRelay } from "../messages/service";

type CreateUrlHostOptions = {
  agents: AgentsService;
  access: AccessService;
  connections: ConnectionsService;
  receiveRelay: ReceiveRelay;
};

// What the server does for the Message URL, which it carries itself: the channel's rules stay in
// its package, and the server decides by the agent's list, keeps the message among the messages
// of both agents and wakes the one it is for.
export function createUrlHost({
  agents,
  access,
  connections,
  receiveRelay,
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

    handOver: receiveRelay,
  };
}
