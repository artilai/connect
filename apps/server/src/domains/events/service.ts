import type { FilesService } from "../files/service";
import type { EventBus } from "./bus";
import type { EventsRepository } from "./repository";
import { type EventRecord, type EventRow, isRelay, type NewEvent, type Relay } from "./schema";

type CreateEventsServiceOptions = {
  eventsRepository: EventsRepository;
  bus: EventBus;
  files: FilesService;
};

type AddOptions = { accountId: string; event: NewEvent };

type RelayOptions = { accountId: string; event: Relay };

type ListAfterOptions = { accountId: string; cursor: number };

type FindRelayOptions = { accountId: string; messageId: string };

export function createEventsService({ eventsRepository, bus, files }: CreateEventsServiceOptions) {
  // A relayed message, which names its sender, brings its files with its event, as the rest of the
  // message does.
  function toRecords(rows: EventRow[]): EventRecord[] {
    const attachmentsByMessage = files.describeByMessages(
      rows.flatMap(({ sender, messageId }) => (sender ? [messageId] : [])),
    );

    return rows.map(
      ({ id, type, channel, messageId, text, sender, thread, toThread, client, createdAt }) => {
        if (!sender) return { id, type, channel, messageId, toThread, createdAt };

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

  // Tells the account's client a message came.
  function add(options: AddOptions) {
    const [record] = toRecords([eventsRepository.add(options)]);

    if (!record) throw new Error("The event went missing");

    bus.publish(options.accountId);

    return record;
  }

  return {
    add,

    // Hands the account's client a message on the Message URL whole.
    relay(options: RelayOptions) {
      const record = add(options);

      if (!isRelay(record)) throw new Error(`Event ${record.id} carries no message`);

      return record;
    },

    listLatest: (accountId: string) => toRecords(eventsRepository.listLatest(accountId)),

    listAfter: (options: ListAfterOptions) => toRecords(eventsRepository.listAfter(options)),

    findLastId: eventsRepository.findLastId,

    // A message relayed to the account, to answer whoever sent it.
    findRelay(options: FindRelayOptions) {
      const row = eventsRepository.findRelay(options);
      const [record] = row ? toRecords([row]) : [];

      return record && isRelay(record) ? record : undefined;
    },

    subscribe: (accountId: string, listener: () => void) => bus.subscribe(accountId, listener),
  };
}

export type EventsService = ReturnType<typeof createEventsService>;
