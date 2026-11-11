import type { Channel } from "@artil/channels/contract";
import { channel as urlChannel } from "@artil/url-channel";

import { createAccessRepository } from "../domains/access/repository";
import { createAccessService } from "../domains/access/service";
import { createAccountsRepository } from "../domains/accounts/repository";
import { createAccountsService } from "../domains/accounts/service";
import { createAddressesRepository } from "../domains/addresses/repository";
import { createAddressesService } from "../domains/addresses/service";
import type { ChannelKind } from "../domains/channels/schema";
import { createChannelsService } from "../domains/channels/service";
import { createConnectionsRepository } from "../domains/connections/repository";
import { createConnectionsService } from "../domains/connections/service";
import { createEventBus } from "../domains/events/bus";
import { createEventsRepository } from "../domains/events/repository";
import { createEventsService } from "../domains/events/service";
import { createFileLinks } from "../domains/files/links";
import { createFilesRepository } from "../domains/files/repository";
import { createFilesService } from "../domains/files/service";
import { createMessagesRepository } from "../domains/messages/repository";
import { createMessagesService } from "../domains/messages/service";
import { createSignInsRepository } from "../domains/sign-in/repository";
import { createSignInsService } from "../domains/sign-in/service";
import { createTeamService } from "../domains/team/service";
import { createTokensRepository } from "../domains/tokens/repository";
import { createTokensService } from "../domains/tokens/service";
import type { Database } from "../platform/db/connection";
import type { FileStore } from "../platform/storage";

type CreateServicesOptions = {
  db: Database;
  // Signs file links, so only this server makes ones it accepts.
  secret: string;
  // Where clients reach the server, which file links point at.
  baseUrl: string;
  // The server's address on the internet, where providers post; none in local mode.
  publicUrl?: string;
  store?: FileStore;
  // The channels the config loads; the server carries the Message URL itself.
  channels: ReadonlyMap<ChannelKind, Channel>;
  log: (line: string) => void;
};

// Every domain's service, which routes, tools and commands work with; repositories stay inside.
export function createServices({
  db,
  secret,
  baseUrl,
  publicUrl,
  store,
  channels: loadedChannels,
  log,
}: CreateServicesOptions) {
  const files = createFilesService({ filesRepository: createFilesRepository(db), store, log });
  const fileLinks = createFileLinks({ secret, apiUrl: `${baseUrl}/api` });

  const access = createAccessService({ accessRepository: createAccessRepository(db) });

  const accounts = createAccountsService({
    accountsRepository: createAccountsRepository(db),
    access,
    files,
  });

  const tokens = createTokensService({ tokensRepository: createTokensRepository(db) });

  const events = createEventsService({
    eventsRepository: createEventsRepository(db),
    bus: createEventBus(),
  });

  const connections = createConnectionsService({
    connectionsRepository: createConnectionsRepository(db),
    events,
  });

  // Every channel behind the one interface, whatever carries its messages.
  const channels = createChannelsService({
    channels: new Map<ChannelKind, Channel>([...loadedChannels, [urlChannel.kind, urlChannel]]),
    publicUrl,
    secret,
  });

  const addresses = createAddressesService({
    addressesRepository: createAddressesRepository(db),
    accounts,
    channels,
  });

  const messages = createMessagesService({
    messagesRepository: createMessagesRepository(db),
    accounts,
    files,
    addresses,
    access,
    events,
    channels,
    log,
  });

  return {
    accounts,
    tokens,
    signIns: createSignInsService({ signInsRepository: createSignInsRepository(db), tokens }),
    addresses,
    access,
    connections,
    events,
    messages,
    files,
    fileLinks,
    channels,
    team: createTeamService({ accounts, addresses, connections }),
  };
}

export type Services = ReturnType<typeof createServices>;
