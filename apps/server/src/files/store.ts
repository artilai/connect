import { S3Client } from "bun";

import type { S3Settings } from "../config";

type StoredObject = { key: string; bytes: Uint8Array; type: string };

// Where files keep their bytes.
export type FileStore = {
  put: (object: StoredObject) => Promise<void>;
  read: (key: string) => Promise<Uint8Array>;
  remove: (key: string) => Promise<void>;
};

export function createS3Store({
  endpoint,
  bucket,
  region,
  accessKeyId,
  secretAccessKey,
}: S3Settings) {
  const client = new S3Client({ endpoint, bucket, region, accessKeyId, secretAccessKey });

  return {
    put: async ({ key, bytes, type }) => {
      await client.write(key, bytes, { type });
    },
    read: async (key) => new Uint8Array(await client.file(key).arrayBuffer()),
    remove: (key) => client.delete(key),
  } satisfies FileStore;
}

// Writes a file and reads it back, so setup finds out at once whether the bucket takes files.
export async function checkStore(store: FileStore) {
  const key = `checks/${crypto.randomUUID()}`;
  const bytes = new TextEncoder().encode("artil-server");

  await store.put({ key, bytes, type: "text/plain" });

  const read = await store.read(key);

  await store.remove(key);

  if (new TextDecoder().decode(read) !== "artil-server") {
    throw new Error("The bucket gave back other bytes than it was given");
  }
}

export function createMemoryStore() {
  const objects = new Map<string, Uint8Array>();

  const store: FileStore = {
    put: async ({ key, bytes }) => {
      objects.set(key, bytes);
    },
    read: async (key) => {
      const bytes = objects.get(key);

      if (!bytes) throw new Error(`No object ${key}`);

      return bytes;
    },
    remove: async (key) => {
      objects.delete(key);
    },
  };

  return { store, objects };
}
