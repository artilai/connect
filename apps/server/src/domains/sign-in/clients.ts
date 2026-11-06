import { z } from "zod";

import { AppError } from "@artil/errors";

import { labelSchema } from "../../platform/http/validate";

const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];

const unsafeSchemes = ["javascript:", "data:", "file:", "blob:", "about:", "vbscript:"];

function isLoopback(url: URL) {
  return url.protocol === "http:" && loopbackHosts.includes(url.hostname);
}

// A client may only send codes over TLS, to its own machine or to an app's own URL scheme.
function isRedirectUri(value: string) {
  if (!URL.canParse(value)) return false;

  const url = new URL(value);

  if (url.hash) return false;

  return url.protocol === "http:" ? isLoopback(url) : !unsafeSchemes.includes(url.protocol);
}

export const registrationSchema = z.object({
  client_name: labelSchema("The client's name", 80).default("MCP client"),
  redirect_uris: z
    .array(
      z.string().refine(isRedirectUri, "Each redirect URI must be https, loopback or an app's"),
    )
    .min(1)
    .max(10),
});

type Registration = z.output<typeof registrationSchema>;

export type OAuthClient = { id: string; name: string; redirectUris: string[] };

// Anyone may register, so the client id carries the client's details rather than pointing at a stored row.
export function registeredClientId({ client_name, redirect_uris }: Registration) {
  return Buffer.from(JSON.stringify({ client_name, redirect_uris })).toString("base64url");
}

function registrationOf(clientId: string) {
  try {
    return registrationSchema.safeParse(JSON.parse(Buffer.from(clientId, "base64url").toString()));
  } catch {
    return undefined;
  }
}

export function readClient(clientId: string): OAuthClient {
  const registration = registrationOf(clientId);

  if (!registration?.success) {
    throw new AppError({
      code: "invalid_input",
      message: "Unknown client_id: register the client at /oauth/register first",
    });
  }

  const { client_name: name, redirect_uris: redirectUris } = registration.data;

  return { id: clientId, name, redirectUris };
}

// Native clients listen on any free port of a loopback address, so the port is left out of the match.
function comparable(uri: string) {
  const url = new URL(uri);

  if (isLoopback(url)) url.port = "";

  return url.href;
}

export function allowsRedirect({ redirectUris }: OAuthClient, redirectUri: string) {
  if (!URL.canParse(redirectUri)) return false;

  const requested = comparable(redirectUri);

  return redirectUris.some((uri) => URL.canParse(uri) && comparable(uri) === requested);
}
