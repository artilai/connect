import { AppError } from "@artil/errors";

import type { FilesService } from "../files/service";
import type { AgentsRepository } from "./repository";

// Agent ids look like Artil Cloud's: eight characters of Crockford's base32.
const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";

const namePattern = /^[^\p{Cc}\p{Cf}]{1,80}$/v;

function newAgentId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => alphabet[byte % 32]).join(
    "",
  );
}

type CreateAgentsServiceOptions = { agentsRepository: AgentsRepository; files: FilesService };

export function createAgentsService({ agentsRepository, files }: CreateAgentsServiceOptions) {
  return {
    findById: agentsRepository.findById,
    findByIdOrName: agentsRepository.findByIdOrName,
    list: agentsRepository.list,

    // An agent a person names by its id or name, as the commands take one.
    getByIdOrName(idOrName: string) {
      const agent = agentsRepository.findByIdOrName(idOrName);

      if (!agent) {
        throw new AppError({
          code: "not_found",
          message: `There is no account ${idOrName}; see artil-server account list`,
        });
      }

      return agent;
    },

    create(name: string) {
      const trimmed = name.trim();

      if (!namePattern.test(trimmed)) {
        throw new AppError({
          code: "invalid_input",
          message: "An agent's name is 1 to 80 characters, with no control characters",
        });
      }

      if (agentsRepository.findByIdOrName(trimmed)) {
        throw new AppError({ code: "conflict", message: `There is already an agent ${trimmed}` });
      }

      return agentsRepository.create({ id: newAgentId(), name: trimmed });
    },

    // Removes the agent with its messages and sign-ins, and its files from the bucket.
    async remove(id: string) {
      await files.removeByAgent(id);

      return agentsRepository.remove(id);
    },
  };
}

export type AgentsService = ReturnType<typeof createAgentsService>;
