import type { AddressesService } from "../addresses/service";
import type { AgentsService } from "../agents/service";
import type { ConnectionsService } from "../connections/service";
import type { TeamMember } from "./schema";

type CreateTeamServiceOptions = {
  agents: AgentsService;
  addresses: AddressesService;
  connections: ConnectionsService;
};

export function createTeamService({ agents, addresses, connections }: CreateTeamServiceOptions) {
  return {
    // The server's agents, which are its whole team, in the order they were made.
    list: (): TeamMember[] =>
      agents.list().map((agent) => ({
        agent,
        addresses: addresses
          .listByAgent(agent.id)
          .map(({ channel, value }) => ({ channel, value })),
        listening: connections.isListening(agent.id),
      })),
  };
}

export type TeamService = ReturnType<typeof createTeamService>;
