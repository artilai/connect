import type { FilesService } from "../files/service";
import type { EventBus } from "./bus";
import type { EventsRepository } from "./repository";
import { type EventRecord, type EventRow, isRelay, type NewEvent, type Relay } from "./schema";

type CreateEventsServiceOptions = {
  eventsRepository: EventsRepository;
  bus: EventBus;
  files: FilesService;
};

type AddOptions = { agentId: string; event: NewEvent };

type RelayOptions = { agentId: string; event: Relay };

type ListAfterOptions = { agentId: string; cursor: number };

type FindRelayOptions = { agentId: string; messageId: string };

export function createEventsService({ eventsRepository, bus, files }: CreateEventsServiceOptions) {
  // A relayed message, which names its sender, brings its files with its event, as the server
  // keeps no other copy of it.
  function toRecords(rows: EventRow[]): EventRecord[] {
    const attachmentsByMessage = files.describeByMessages(
      rows.flatMap(({ sender, messageId }) => (sender ? [messageId] : [])),
    );

    return rows.map(
      ({ id, type, channel, messageId, text, sender, thread, toThread, client, createdAt }) => {
        if (!sender) return { id, type, channel, messageId, createdAt };

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

  // Tells the agent's client a message came.
  function add(options: AddOptions) {
    const [record] = toRecords([eventsRepository.add(options)]);

    if (!record) throw new Error("The event went missing");

    bus.publish(options.agentId);

    return record;
  }

  return {
    add,

    // Hands the agent's client a message whole, as the inbox keeps no copy of it.
    relay(options: RelayOptions) {
      const record = add(options);

      if (!isRelay(record)) throw new Error(`Event ${record.id} carries no message`);

      return record;
    },

    listLatest: (agentId: string) => toRecords(eventsRepository.listLatest(agentId)),

    listAfter: (options: ListAfterOptions) => toRecords(eventsRepository.listAfter(options)),

    findLastId: eventsRepository.findLastId,

    // A message relayed to the agent, to answer whoever sent it.
    findRelay(options: FindRelayOptions) {
      const row = eventsRepository.findRelay(options);
      const [record] = row ? toRecords([row]) : [];

      return record && isRelay(record) ? record : undefined;
    },

    subscribe: (agentId: string, listener: () => void) => bus.subscribe(agentId, listener),
  };
}

export type EventsService = ReturnType<typeof createEventsService>;
