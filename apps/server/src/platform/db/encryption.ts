import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { customType } from "drizzle-orm/sqlite-core";

const algorithm = "aes-256-gcm";

const keyLength = 32;

const nonceLength = 12;

const tagLength = 16;

// One server runs in a process, so the key its database and bucket encrypt with is the process's.
let key: Buffer | undefined;

// The key comes from the server's secret, under a name of its own, so nothing the secret signs
// gives it away.
export function initEncryption(secret: string) {
  key = Buffer.from(hkdfSync("sha256", secret, "", "encryption", keyLength));
}

// A text column the database keeps encrypted. Each value names its column, so one moved to
// another column does not decrypt.
export function encryptedText(table: string, column: string) {
  const label = `${table}.${column}`;

  return customType<{ data: string; driverData: string }>({
    dataType: () => "text",
    toDriver: (plaintext) => encryptText(plaintext, label),
    fromDriver: (stored) => decryptBytes(Buffer.from(stored, "base64url"), label).toString("utf8"),
  })(column);
}

function encryptText(plaintext: string, label: string) {
  return encryptBytes(Buffer.from(plaintext, "utf8"), label).toString("base64url");
}

// Bytes kept outside the database, like a file in the bucket, under the same key as the columns.
export function encryptBytes(bytes: Uint8Array, label: string) {
  const nonce = randomBytes(nonceLength);
  const cipher = createCipheriv(algorithm, activeKey(label), nonce);

  cipher.setAAD(Buffer.from(label));

  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);

  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

export function decryptBytes(sealed: Uint8Array, label: string) {
  const payload = Buffer.from(sealed);
  const decryptionKey = activeKey(label);

  try {
    const decipher = createDecipheriv(algorithm, decryptionKey, payload.subarray(0, nonceLength), {
      authTagLength: tagLength,
    });

    decipher.setAAD(Buffer.from(label));
    decipher.setAuthTag(payload.subarray(-tagLength));

    return Buffer.concat([
      decipher.update(payload.subarray(nonceLength, -tagLength)),
      decipher.final(),
    ]);
  } catch {
    throw new Error(`${label} does not decrypt with this server's secret`);
  }
}

function activeKey(label: string) {
  if (!key) throw new Error(`Open the database before reading or writing ${label}`);

  return key;
}
