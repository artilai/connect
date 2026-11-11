import type { EventBus } from "./bus";
import type { EventsRepository } from "./repository";
import type { EventRecord, EventRow, NewEvent } from "./schema";

type CreateEventsServiceOptions = { eventsRepository: EventsRepository; bus: EventBus };

type AddOptions = { accountId: string; event: NewEvent };

type ListAfterOptions = { accountId: string; cursor: number };

function toRecord({ id, type, channel, messageId, toThread, createdAt }: EventRow): EventRecord {
  return { id, type, channel, messageId, toThread, createdAt };
}

export function createEventsService({ eventsRepository, bus }: CreateEventsServiceOptions) {
  return {
    // Tells the account's client a message came.
    add(options: AddOptions) {
      eventsRepository.add(options);
      bus.publish(options.accountId);
    },

    listLatest: (accountId: string) => eventsRepository.listLatest(accountId).map(toRecord),

    listAfter: (options: ListAfterOptions) => eventsRepository.listAfter(options).map(toRecord),

    findLastId: eventsRepository.findLastId,

    subscribe: (accountId: string, listener: () => void) => bus.subscribe(accountId, listener),
  };
}

export type EventsService = ReturnType<typeof createEventsService>;
