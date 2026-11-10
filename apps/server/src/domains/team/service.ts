import type { AccountsService } from "../accounts/service";
import type { AddressesService } from "../addresses/service";
import type { ConnectionsService } from "../connections/service";
import type { TeamMember } from "./schema";

type CreateTeamServiceOptions = {
  accounts: AccountsService;
  addresses: AddressesService;
  connections: ConnectionsService;
};

export function createTeamService({ accounts, addresses, connections }: CreateTeamServiceOptions) {
  return {
    // The server's accounts, which are its whole team, in the order they were made.
    list: (): TeamMember[] =>
      accounts.list().map((account) => ({
        account,
        addresses: addresses
          .listByAccount(account.id)
          .map(({ channel, value }) => ({ channel, value })),
        listening: connections.isListening(account.id),
      })),
  };
}

export type TeamService = ReturnType<typeof createTeamService>;
