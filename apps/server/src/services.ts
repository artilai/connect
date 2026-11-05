import type { Channel } from "@artil/channels/contract";
import { createUrlChannel } from "@artil/url-channel/channel";

import { createAccessRepository } from "./access/repository";
import { createAddressesRepository } from "./addresses/repository";
import { createAgentsRepository } from "./agents/repository";
import type { ArrivalKind, ChannelKind } from "./channels/kinds";
import { createConnectionsRepository } from "./connections/repository";
import type { Database } from "./db/connection";
import { createEventBus } from "./events/bus";
import { createEventsRepository } from "./events/repository";
import { createFileLinks } from "./files/links";
import { createFilesRepository } from "./files/repository";
import { createFilesService } from "./files/service";
import type { FileStore } from "./files/store";
import { createInbound } from "./messages/inbound";
import { createMessagesRepository } from "./messages/repository";
import { createSender } from "./messages/send";
import { createSignInsRepository } from "./sign-in/repository";
import { createTokensRepository } from "./tokens/repository";
import { createUrlHost } from "./url/host";
import { createUrlRelay } from "./url/relay";

type CreateServicesOptions = {
  db: Database;
  // Signs file links, so only this server makes ones it accepts.
  secret: string;
  // Where clients reach the server, which file links point at.
  baseUrl: string;
  store: FileStore | undefined;
  // The channels with a provider, like Telegram; the server carries the Message URL itself.
  channels: ReadonlyMap<ChannelKind, Channel<ChannelKind>>;
  log: (line: string) => void;
};

// The repositories and services the server's routes and commands work with.
export function createServices({
  db,
  secret,
  baseUrl,
  store,
  channels: providerChannels,
  log,
}: CreateServicesOptions) {
  const filesRepository = createFilesRepository(db);
  const bus = createEventBus();
  const tokens = createTokensRepository(db);
  const agents = createAgentsRepository(db);
  const addresses = createAddressesRepository(db);
  const access = createAccessRepository(db);
  const connections = createConnectionsRepository(db);
  const events = createEventsRepository({ db, files: filesRepository, bus });
  const messages = createMessagesRepository({ db, files: filesRepository });
  const files = createFilesService({ filesRepository, store, log });
  const fileLinks = createFileLinks({ secret, apiUrl: `${baseUrl}/api` });

  const urlChannel = createUrlChannel(
    createUrlHost({ agents, access, connections, events, files }),
  );

  // Every channel behind the one interface, whatever carries its messages.
  const channels = new Map<ArrivalKind, Channel<ArrivalKind>>([
    ...providerChannels,
    ["url", urlChannel],
  ]);

  return {
    agents,
    tokens,
    signIns: createSignInsRepository({ db, tokens }),
    addresses,
    access,
    connections,
    events,
    messages,
    files,
    fileLinks,
    channels,
    receive: createInbound({ addresses, access, messages, events, files }),
    send: createSender({ addresses, messages, files, fileLinks, channels }),
    relay: createUrlRelay({ channel: urlChannel, events, files }),
  };
}

export type Services = ReturnType<typeof createServices>;
