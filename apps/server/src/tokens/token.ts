import { createHash, randomBytes } from "node:crypto";

const prefix = "artil_";

export function randomSecret() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

// Tokens look like Artil Cloud's, so the CLI reads them the same way.
export function mintToken() {
  const token = prefix + randomSecret();

  return { token, hash: hashToken(token) };
}

export function readToken(authorization: string | undefined) {
  const [scheme, token] = authorization?.split(" ") ?? [];

  return scheme?.toLowerCase() === "bearer" && token?.startsWith(prefix) ? token : undefined;
}
