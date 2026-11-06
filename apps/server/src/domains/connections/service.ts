import type { EventsService } from "../events/service";
import type { ConnectionsRepository } from "./repository";

type CreateConnectionsServiceOptions = {
  connectionsRepository: ConnectionsRepository;
  events: EventsService;
};

type ConnectOptions = {
  agentId: string;
  tokenHash: string;
  client: string;
  machine: string | null;
};

export function createConnectionsService({
  connectionsRepository,
  events,
}: CreateConnectionsServiceOptions) {
  return {
    findByAgent: connectionsRepository.findByAgent,

    // Connects a client in place of any other; one new to the agent hears from its last event on.
    connect: (options: ConnectOptions) =>
      connectionsRepository.connect({
        ...options,
        lastEventId: events.findLastId(options.agentId),
      }),

    checkIn: connectionsRepository.checkIn,
    isListening: connectionsRepository.isListening,
  };
}

export type ConnectionsService = ReturnType<typeof createConnectionsService>;
