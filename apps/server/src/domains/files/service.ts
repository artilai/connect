import type { InboundFile } from "@artil/channels/contract";
import { AppError, messageOf } from "@artil/errors";

import {
  decryptContent,
  encryptContent,
  type FileStore,
  type Upload,
} from "../../platform/storage";
import type { FilesRepository } from "./repository";
import { type AttachmentInput, type FileRecord, toMessageAttachment } from "./schema";

type CreateFilesServiceOptions = {
  filesRepository: FilesRepository;
  store?: FileStore;
  log: (line: string) => void;
};

type SaveOptions = {
  accountId: string;
  messageId: string;
  // A file the channel handed over without its bytes is saved by its description.
  uploads: readonly InboundFile[];
};

type ReadForSendingOptions = { accountId: string; fileId: string };

type ReadAttachmentsOptions = { accountId: string; attachments: readonly AttachmentInput[] };

const encoder = new TextEncoder();

type PutInStoreOptions = { key: string; bytes: Uint8Array; type: string };

export function createFilesService({ filesRepository, store, log }: CreateFilesServiceOptions) {
  function unavailableError() {
    return new AppError({
      code: "unavailable",
      message: "Files are off on this server; turn them on with an S3 bucket in artil-server setup",
    });
  }

  // A file's bytes, until it expires.
  async function readContent(file: FileRecord) {
    if (!store || file.key === null || (file.expiresAt && file.expiresAt <= new Date())) {
      return undefined;
    }

    return decryptContent(await store.read(file.key));
  }

  // Puts a file in the bucket and says whether it went in. A file that did not is saved by its
  // description, so the message it came with still arrives.
  async function putInStore({ bytes, ...object }: PutInStoreOptions) {
    if (!store) return false;

    try {
      await store.put({ ...object, bytes: encryptContent(bytes) });

      return true;
    } catch (cause) {
      log(`Could not put a file in the bucket: ${messageOf(cause, String(cause))}`);

      return false;
    }
  }

  // Removes files with their bytes. A file the bucket fails to remove keeps its row, so the next
  // removal of expired files tries it again.
  async function removeFiles(files: readonly FileRecord[]) {
    for (const file of files) {
      try {
        if (store && file.key !== null) await store.remove(file.key);

        filesRepository.remove(file.id);
      } catch (cause) {
        log(`Could not remove a file from the bucket: ${messageOf(cause, String(cause))}`);
      }
    }
  }

  // A file the account received or sent, to send on.
  async function readForSending({ accountId, fileId }: ReadForSendingOptions): Promise<Upload> {
    if (!store) throw unavailableError();

    const file = filesRepository.findById(fileId);
    const content = file?.accountId === accountId ? await readContent(file) : undefined;

    if (!file || !content) {
      throw new AppError({
        code: "not_found",
        message: `There is no file with the id ${fileId}`,
      });
    }

    return { name: file.name, type: file.type, size: file.size, content };
  }

  return {
    enabled: Boolean(store),

    readForSending,

    // Reads the files a message to send names, with their bytes: ones the account has, and text
    // files written for it.
    readAttachments: ({ accountId, attachments }: ReadAttachmentsOptions): Promise<Upload[]> =>
      Promise.all(
        attachments.map(async (file) => {
          if ("id" in file) return readForSending({ accountId, fileId: file.id });

          const content = encoder.encode(file.text);

          return { name: file.name, type: file.type, size: content.byteLength, content };
        }),
      ),

    // What each message tells of its files, in the order they came.
    describeByMessages: (messageIds: readonly string[]) =>
      new Map(
        filesRepository
          .listByMessages(messageIds)
          .entries()
          .map(([messageId, records]) => [messageId, records.map(toMessageAttachment)]),
      ),

    // Saves a message's files: their bytes when the server has a bucket, and their description
    // either way.
    save: ({ accountId, messageId, uploads }: SaveOptions) =>
      Promise.all(
        uploads.map(async ({ name, type, size, content }) => {
          const id = crypto.randomUUID();
          const key = `${accountId}/${id}`;
          const stored = content !== null && (await putInStore({ key, bytes: content, type }));

          return filesRepository.add({
            id,
            accountId,
            messageId,
            name,
            type,
            size,
            key: stored ? key : null,
          });
        }),
      ),

    async read(fileId: string) {
      const file = filesRepository.findById(fileId);
      const content = file ? await readContent(file) : undefined;

      return file && content ? { file, content } : undefined;
    },

    // Removes the expired files: those a message on the Message URL brought before the server kept
    // its messages, a day after it came.
    removeExpired: (now = new Date()) => removeFiles(filesRepository.listExpired(now)),

    // Removes the bytes of an account's files, before the account's removal deletes their rows.
    removeByAccount: (accountId: string) => removeFiles(filesRepository.listByAccount(accountId)),

    unavailableError,
  };
}

export type FilesService = ReturnType<typeof createFilesService>;
