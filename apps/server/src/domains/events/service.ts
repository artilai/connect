import { hour } from "@artil/utils/time";

import type { FilesService } from "../files/service";
import type { EventBus } from "./bus";
import type { EventsRepository } from "./repository";
import { type EventRecord, type EventRow, isRelay, type NewEvent } from "./schema";

type CreateEventsServiceOptions = {
  eventsRepository: EventsRepository;
  bus: EventBus;
  files: FilesService;
};

type AddOptions = { agentId: string; event: NewEvent };

type ListAfterOptions = { agentId: string; cursor: number };

type FindRelayOptions = { agentId: string; messageId: string };

export function createEventsService({ eventsRepository, bus, files }: CreateEventsServiceOptions) {
  // A relayed message's files come with its event, as the rest of the message does.
  function toRecords(rows: EventRow[]): EventRecord[] {
    const attachmentsByMessage = files.describeByMessages(
      rows.flatMap(({ channel, messageId }) => (channel === "url" ? [messageId] : [])),
    );

    return rows.map(
      ({ id, type, channel, messageId, text, sender, thread, toThread, client, createdAt }) => {
        if (channel !== "url") return { id, type, channel, messageId, createdAt };

        if (!sender) throw new Error(`Event ${id} on url names no sender`);

        return {
          id,
          type,
          channel,
          messageId,
          text,
          sender,
          thread,
          toThread,
          client,
          createdAt,
          attachments: attachmentsByMessage.get(messageId) ?? [],
        };
      },
    );
  }

  return {
    add(options: AddOptions) {
      const [record] = toRecords([eventsRepository.add(options)]);

      if (!record) throw new Error("The event went missing");

      bus.publish(options.agentId);

      return record;
    },

    listLatest: (agentId: string) => toRecords(eventsRepository.listLatest(agentId)),

    listAfter: (options: ListAfterOptions) => toRecords(eventsRepository.listAfter(options)),

    findLastId: eventsRepository.findLastId,

    // A message the Message URL relayed to the agent, to answer whoever sent it.
    findRelay(options: FindRelayOptions) {
      const row = eventsRepository.findRelay(options);
      const [record] = row ? toRecords([row]) : [];

      return record && isRelay(record) ? record : undefined;
    },

    // Every message that reached the agent woke it, whichever channel it came by.
    countWakesInLastHour: (agentId: string) =>
      eventsRepository.countSince({ agentId, since: new Date(Date.now() - hour) }),

    subscribe: (agentId: string, listener: () => void) => bus.subscribe(agentId, listener),
  };
}

export type EventsService = ReturnType<typeof createEventsService>;
