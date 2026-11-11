import type { Channel } from "@artil/channels/contract";
import { UrlChannel } from "@artil/url-channel/channel";

import { createAccessRepository } from "../domains/access/repository";
import { createAccessService } from "../domains/access/service";
import { createAddressesRepository } from "../domains/addresses/repository";
import { createAddressesService } from "../domains/addresses/service";
import { createAgentsRepository } from "../domains/agents/repository";
import { createAgentsService } from "../domains/agents/service";
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
import { createUrlHost } from "../domains/url/host";
import { createUrlService } from "../domains/url/service";
import type { Database } from "../platform/db/connection";
import type { FileStore } from "../platform/storage";

type CreateServicesOptions = {
  db: Database;
  // Signs file links, so only this server makes ones it accepts.
  secret: string;
  // Where clients reach the server, which file links point at.
  baseUrl: string;
  store: FileStore | undefined;
  // The channels the config loads; the server carries the Message URL itself.
  channels: ReadonlyMap<ChannelKind, Channel>;
  log: (line: string) => void;
};

// Every domain's service, which routes, tools and commands work with; repositories stay inside.
export function createServices({
  db,
  secret,
  baseUrl,
  store,
  channels: loadedChannels,
  log,
}: CreateServicesOptions) {
  const files = createFilesService({ filesRepository: createFilesRepository(db), store, log });
  const fileLinks = createFileLinks({ secret, apiUrl: `${baseUrl}/api` });
  const agents = createAgentsService({ agentsRepository: createAgentsRepository(db), files });
  const tokens = createTokensService({ tokensRepository: createTokensRepository(db) });

  const events = createEventsService({
    eventsRepository: createEventsRepository(db),
    bus: createEventBus(),
    files,
  });

  const connections = createConnectionsService({
    connectionsRepository: createConnectionsRepository(db),
    events,
  });

  const access = createAccessService({ accessRepository: createAccessRepository(db), events });

  // The Message URL hands what it carries to the messages, which send on it in turn, so its host
  // reaches them once they are made.
  const urlChannel = new UrlChannel(
    createUrlHost({
      agents,
      access,
      connections,
      receiveRelay: async (delivery) => messages.receiveRelay(delivery),
    }),
  );

  // Every channel behind the one interface, whatever carries its messages.
  const channels = createChannelsService(
    new Map<ChannelKind, Channel>([...loadedChannels, ["url", urlChannel]]),
  );

  const addresses = createAddressesService({
    addressesRepository: createAddressesRepository(db),
    channels,
  });

  const url = createUrlService({ channel: urlChannel, events, files });

  const messages = createMessagesService({
    messagesRepository: createMessagesRepository(db),
    files,
    fileLinks,
    addresses,
    access,
    events,
    channels,
    url,
  });

  return {
    agents,
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
    url,
    team: createTeamService({ agents, addresses, connections }),
  };
}

export type Services = ReturnType<typeof createServices>;
