import { createHash, randomBytes } from "node:crypto";

export function randomSecret() {
  return randomBytes(32).toString("base64url");
}

// What the server keeps of a secret it hands out, like a token or a sign-in code.
export function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}
