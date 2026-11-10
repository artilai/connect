import { AppError } from "@artil/errors";

import type { ChannelKind } from "../channels/schema";
import { urlKind } from "../url/schema";
import { admissionOf, admit } from "./admission";
import type { AccessRepository } from "./repository";
import type { Admit, Group } from "./schema";

type CreateAccessServiceOptions = { accessRepository: AccessRepository };

type SetAdmitOptions = { agentId: string; channel: ChannelKind; admit: Admit };

type GroupOptions = { agentId: string; channel: ChannelKind; group: Group };

type SetGroupOptions = GroupOptions & { allowed: boolean };

type AdmitAfterOptions = { current: Admit; group: Group; allowed: boolean };

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

// Who wakes the agent once anyone or the team is let in or kept out. Anyone takes in the team, so
// letting anyone in lets the team in too, and keeping the team out keeps anyone out.
function admitAfter({ current, group, allowed }: AdmitAfterOptions): Admit {
  if (allowed) return group === "anyone" || current === "anyone" ? "anyone" : "team";

  if (group === "team") return "list";

  return current === "anyone" ? "team" : current;
}

export function createAccessService({ accessRepository }: CreateAccessServiceOptions) {
  // Only the server's agents reach the Message URL, so it is never open to anyone.
  function setAdmit(options: SetAdmitOptions) {
    if (options.channel === urlKind && options.admit === "anyone") {
      throw new AppError({
        code: "invalid_input",
        message: "Only the team or the senders you list can wake an agent at its Message URL",
      });
    }

    accessRepository.setAdmit(options);
  }

  // Lets anyone or the team wake the agent beside its list, or keeps them out, and returns who
  // wakes it then.
  function setGroup({ agentId, channel, group, allowed }: SetGroupOptions) {
    const current = accessRepository.read({ agentId, channel }).admit;
    const next = admitAfter({ current, group, allowed });

    setAdmit({ agentId, channel, admit: next });

    return { admit: next, changed: next !== current };
  }

  return {
    read: accessRepository.read,
    addSender: accessRepository.addSender,
    removeSender: accessRepository.removeSender,
    setAdmit,
    addGroup: (options: GroupOptions) => setGroup({ ...options, allowed: true }),
    removeGroup: (options: GroupOptions) => setGroup({ ...options, allowed: false }),

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
