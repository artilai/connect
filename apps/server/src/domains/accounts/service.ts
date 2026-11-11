import { AppError } from "@artil/errors";

import type { AccessService } from "../access/service";
import type { FilesService } from "../files/service";
import { urlKind } from "../url/schema";
import type { AccountsRepository } from "./repository";

// Account ids look like Artil Cloud's: eight characters of Crockford's base32.
const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";

const namePattern = /^[^\p{Cc}\p{Cf}]{1,80}$/v;

function newAccountId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => alphabet[byte % 32]).join(
    "",
  );
}

type CreateAccountsServiceOptions = {
  accountsRepository: AccountsRepository;
  access: AccessService;
  files: FilesService;
};

type ReadNameOptions = { name: string; accountId?: string };

type RenameOptions = { id: string; name: string };

export function createAccountsService({
  accountsRepository,
  access,
  files,
}: CreateAccountsServiceOptions) {
  // A name a person gives the account: 1 to 80 characters, and no other account's name or id.
  function readName({ name, accountId }: ReadNameOptions) {
    const trimmed = name.trim();

    if (!namePattern.test(trimmed)) {
      throw new AppError({
        code: "invalid_input",
        message: "An account's name is 1 to 80 characters, with no control characters",
      });
    }

    const holder = accountsRepository.findByIdOrName(trimmed);

    if (holder && holder.id !== accountId) {
      throw new AppError({ code: "conflict", message: `There is already an account ${trimmed}` });
    }

    return trimmed;
  }

  return {
    findById: accountsRepository.findById,
    findByIdOrName: accountsRepository.findByIdOrName,

    // A sender on a list as a person knows them: an account of this server by its name.
    toSenderName: (sender: string) => accountsRepository.findById(sender)?.name ?? sender,

    list: accountsRepository.list,

    // An account a person names by its id or name, as the commands take one.
    getByIdOrName(idOrName: string) {
      const account = accountsRepository.findByIdOrName(idOrName);

      if (!account) {
        throw new AppError({
          code: "not_found",
          message: `There is no account ${idOrName}; see artil-server account list`,
        });
      }

      return account;
    },

    create: (name: string) =>
      accountsRepository.create({ id: newAccountId(), name: readName({ name }) }),

    // Gives the account another name, and returns it; its id, and so its sign-ins and the lists it
    // is on, stay as they are.
    rename({ id, name }: RenameOptions) {
      const newName = readName({ name, accountId: id });

      accountsRepository.rename({ id, name: newName });

      return newName;
    },

    // Removes the account with its messages and sign-ins, its files from the bucket, and itself
    // from the other accounts' lists at their Message URLs, where it goes by its id.
    async remove(id: string) {
      await files.removeByAccount(id);
      access.removeSenderEverywhere({ channel: urlKind, sender: id });

      return accountsRepository.remove(id);
    },
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;
