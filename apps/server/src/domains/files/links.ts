import { createHmac, timingSafeEqual } from "node:crypto";

import { minute, second } from "@artil/utils/time";

// How long a link to a file works without a sign-in; reading the message again gives a new one.
const fileLinkLifetime = 15 * minute;

type Signed = { fileId: string; expiresAt: number; signature: string };

type CreateFileLinksOptions = { secret: string; apiUrl: string; now?: () => number };

type LinkOptions = {
  fileId: string;
  // A file the server keeps only for a while can have a link that works as long as it is there.
  until?: number;
};

// Signs links to files so that whoever holds one can download the file until it expires, with
// no sign-in: a person clicking it in a chat, or a model fetching it.
export function createFileLinks({ secret, apiUrl, now = Date.now }: CreateFileLinksOptions) {
  function signature(fileId: string, expiresAt: number) {
    return createHmac("sha256", secret).update(`${fileId}.${expiresAt}`).digest("base64url");
  }

  return {
    link({ fileId, until = now() + fileLinkLifetime }: LinkOptions) {
      const expiresAt = Math.floor(until / second);

      return `${apiUrl}/files/${fileId}?exp=${expiresAt}&sig=${signature(fileId, expiresAt)}`;
    },

    verify({ fileId, expiresAt, signature: given }: Signed) {
      if (expiresAt * second < now()) return false;

      const expected = Buffer.from(signature(fileId, expiresAt));
      const actual = Buffer.from(given);

      return expected.length === actual.length && timingSafeEqual(expected, actual);
    },
  };
}
