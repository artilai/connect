import { AppError } from "@artil/errors";
import type { UrlChannelHost } from "@artil/url-channel/channel";
import { day } from "@artil/utils/time";

import { admit, defaultLimits, describeRefusal, type Refusal } from "../access/admission";
import type { AccessRepository } from "../access/repository";
import type { AgentsRepository } from "../agents/repository";
import type { ConnectionsRepository } from "../connections/repository";
import type { EventsRepository } from "../events/repository";
import type { FilesService } from "../files/service";
import { toTeammate } from "../team/teammate";

type RefusalErrorOptions = { refusal: Refusal; name: string };

function refusalError({ refusal, name }: RefusalErrorOptions) {
  switch (refusal) {
    case "sender":
      return new AppError({
        code: "forbidden",
        message: `${name} does not take messages from you at its Message URL`,
      });
    case "rate_limit":
      return new AppError({
        code: "rate_limited",
        message: `${name} got too many messages in the last hour; try again later`,
      });
    default:
      return new AppError({ code: "forbidden", message: describeRefusal(refusal) });
  }
}

type CreateUrlHostOptions = {
  agents: AgentsRepository;
  access: AccessRepository;
  connections: ConnectionsRepository;
  events: EventsRepository;
  files: FilesService;
};

// How the server carries the Message URL: the agent takes a message from the server's agents its
// list allows, while someone listens to it; the server keeps the message's files for a day and
// hands the message whole to the agent's event stream.
export function createUrlHost({
  agents,
  access,
  connections,
  events,
  files,
}: CreateUrlHostOptions): UrlChannelHost {
  return {
    async deliver({ from, to, text, files: uploads, thread, toThread, client }) {
      const recipient = agents.findById(to);
      const sender = agents.findById(from);

      if (!recipient) throw new AppError({ code: "not_found", message: "Agent account not found" });

      if (!sender) {
        throw new AppError({ code: "forbidden", message: "Only the team can send here" });
      }

      // The channel lets an agent write to itself only from one of its threads to another, which
      // its list never has to allow.
      const toItself = sender.id === recipient.id;

      const refusal = admit(
        {
          fromSelf: false,
          spam: false,
          withinPlan: true,
          access: toItself
            ? { admit: "list", senders: [recipient.id] }
            : access.read({ agentId: recipient.id, channel: "url" }),
          from: sender.id,
          handle: null,
          fromTeam: true,
          fromVerified: true,
          wakesInLastHour: events.countWakesInLastHour(recipient.id),
        },
        defaultLimits,
      );

      if (refusal) throw refusalError({ refusal, name: recipient.name });

      if (!connections.isListening(recipient.id)) {
        throw new AppError({
          code: "conflict",
          message: `No one is listening to ${recipient.name}; write to it at another of its addresses`,
        });
      }

      if (uploads.length > 0 && !files.enabled) throw files.unavailableError();

      const messageId = crypto.randomUUID();

      // The files go in before the event, so the agent never hears of a message without them.
      await files.save({
        agentId: recipient.id,
        messageId,
        uploads,
        expiresAt: new Date(Date.now() + day),
      });

      events.add({
        agentId: recipient.id,
        event: {
          type: "message.received",
          channel: "url",
          messageId,
          text,
          sender: toTeammate(sender),
          thread,
          toThread,
          client,
        },
      });

      return messageId;
    },
  };
}
