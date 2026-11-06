import type { ChannelKind } from "../channels/schema";
import { admissionOf, admit } from "./admission";
import type { AccessRepository } from "./repository";

type CreateAccessServiceOptions = { accessRepository: AccessRepository };

type DecideOptions = {
  agentId: string;
  channel: ChannelKind;
  from: string;
  // Another address the sender goes by on the channel, which the list can name in place of from.
  handle: string | null;
  fromSelf: boolean;
  spam: boolean;
  fromTeam: boolean;
  fromVerified: boolean;
  // Whether the sender counts as on the agent's list, whatever the list says.
  listed?: boolean;
};

export function createAccessService({ accessRepository }: CreateAccessServiceOptions) {
  return {
    read: accessRepository.read,
    addSender: accessRepository.addSender,
    removeSender: accessRepository.removeSender,

    // Decides whether a message wakes the agent, by its list for the channel, and who its sender
    // is to the agent when it does.
    decide({ agentId, channel, listed = false, ...sender }: DecideOptions) {
      const arrival = {
        ...sender,
        access: listed
          ? { admit: "list" as const, senders: [sender.from] }
          : accessRepository.read({ agentId, channel }),
      };

      const refusal = admit(arrival);

      return { refusal, admission: refusal ? null : admissionOf(arrival) };
    },
  };
}

export type AccessService = ReturnType<typeof createAccessService>;
