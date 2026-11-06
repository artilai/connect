import { hashSecret, randomSecret } from "../../platform/crypto";

const prefix = "artil_";

// Tokens look like Artil Cloud's, so the CLI reads them the same way.
export function mintToken() {
  const token = prefix + randomSecret();

  return { token, hash: hashSecret(token) };
}

export function readToken(authorization: string | undefined) {
  const [scheme, token] = authorization?.split(" ") ?? [];

  return scheme?.toLowerCase() === "bearer" && token?.startsWith(prefix) ? token : undefined;
}
