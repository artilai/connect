import type { InboundMessage } from "@artil/channels/contract";

import { admissionOf, admit, defaultLimits } from "../access/admission";
import type { AccessRepository } from "../access/repository";
import type { AddressesRepository } from "../addresses/repository";
import type { ChannelKind } from "../channels/kinds";
import type { EventsRepository } from "../events/repository";
import type { FilesService } from "../files/service";
import type { MessagesRepository } from "./repository";

type CreateInboundOptions = {
  addresses: AddressesRepository;
  access: AccessRepository;
  messages: MessagesRepository;
  events: EventsRepository;
  files: FilesService;
};

type ReceiveOptions = { channel: ChannelKind; message: InboundMessage };

// Takes a message a channel brought: it wakes the agent the address belongs to when its senders
// may, and stays in the agent's messages either way.
export function createInbound({
  addresses,
  access,
  messages,
  events,
  files,
}: CreateInboundOptions) {
  return async function receive({ channel, message }: ReceiveOptions) {
    const address = addresses.findByValue({ channel, value: message.to });

    if (!address || messages.hasReceived({ addressId: address.id, externalId: message.externalId }))
      return;

    const agentId = address.agentId;
    const sender = addresses.findByValue({ channel, value: message.from });

    const arrival = {
      fromSelf: sender?.agentId === agentId,
      spam: message.spam,
      withinPlan: true,
      access: access.read({ agentId, channel }),
      from: message.from,
      handle: message.fromHandle,
      // Another agent's address on the server is the team's.
      fromTeam: sender !== undefined,
      fromVerified: message.fromVerified,
      wakesInLastHour: events.countWakesInLastHour(agentId),
    };

    const refusal = admit(arrival, defaultLimits);
    const id = crypto.randomUUID();

    // Stored before anything waits, so a message delivered twice at once is taken once.
    messages.add({
      id,
      agentId,
      addressId: address.id,
      channel,
      direction: "inbound",
      externalId: message.externalId,
      counterpart: message.from,
      counterpartName: message.fromName,
      to: message.addressees.to,
      cc: message.addressees.cc,
      subject: message.subject,
      text: message.text,
      thread: message.thread,
      status: refusal ? "refused" : "received",
      refusal,
      admission: refusal ? null : admissionOf(arrival),
    });

    await files.save({ agentId, messageId: id, uploads: message.files });

    if (!refusal) {
      events.add({ agentId, event: { type: "message.received", channel, messageId: id } });
    }
  };
}

export type Receive = ReturnType<typeof createInbound>;
