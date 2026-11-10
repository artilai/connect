import type { EventsService } from "../events/service";
import type { ConnectionsRepository } from "./repository";

type CreateConnectionsServiceOptions = {
  connectionsRepository: ConnectionsRepository;
  events: EventsService;
};

type ConnectOptions = {
  accountId: string;
  tokenHash: string;
  client: string;
  machine: string | null;
};

export function createConnectionsService({
  connectionsRepository,
  events,
}: CreateConnectionsServiceOptions) {
  return {
    findByAccount: connectionsRepository.findByAccount,

    // Connects a client in place of any other; one new to the account hears from its last event on.
    connect: (options: ConnectOptions) =>
      connectionsRepository.connect({
        ...options,
        lastEventId: events.findLastId(options.accountId),
      }),

    checkIn: connectionsRepository.checkIn,
    isListening: connectionsRepository.isListening,
  };
}

export type ConnectionsService = ReturnType<typeof createConnectionsService>;
