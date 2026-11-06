import { Hono } from "hono";
import { z } from "zod";

import { AppError } from "@artil/errors";
import { minute } from "@artil/utils/time";

import { validateJson } from "../../platform/http/validate";
import type { SignInsService } from "./service";

const requestLifetime = 10 * minute;

const secret = /^[A-Za-z0-9_\-]{43}$/v;

function isLoopbackCallback(value: string) {
  const url = new URL(value);

  return (
    url.protocol === "http:" &&
    ["127.0.0.1", "[::1]"].includes(url.hostname) &&
    url.port !== "" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
}

const loopbackCallback = z
  .url()
  .refine(isLoopbackCallback, "The sign-in callback must be an HTTP loopback address with a port");

const requestSchema = z.object({
  machineId: z.uuid(),
  machineName: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[^\p{Cc}\p{Cf}]+$/v),
  redirectUri: loopbackCallback,
  challenge: z.string().regex(secret),
  state: z.string().regex(/^[A-Za-z0-9_\-]{32,128}$/v),
  // Older CLIs ask for agent or account access; this server signs agents in only.
  account: z.boolean().optional(),
});

const exchangeSchema = z.object({
  code: z.string().regex(secret),
  verifier: z.string().regex(/^[A-Za-z0-9._~\-]{43,128}$/v),
  redirectUri: loopbackCallback,
});

type CreateCliSignInRoutesOptions = { signIns: SignInsService };

// The artil CLI signs in the way it does with Artil Cloud: it asks for a sign-in, opens the
// sign-in page in the browser, and trades the code the page sends back for a token.
export function createCliSignInRoutes({ signIns }: CreateCliSignInRoutesOptions) {
  return new Hono()
    .use(async (c, next) => {
      c.header("Cache-Control", "no-store");
      await next();
    })
    .post("/requests", validateJson(requestSchema), (c) => {
      const { machineName, redirectUri, challenge, state } = c.req.valid("json");

      const { id } = signIns.create({
        kind: "cli",
        clientId: null,
        clientName: machineName,
        redirectUri,
        challenge,
        state,
        expiresAt: new Date(Date.now() + requestLifetime),
      });

      return c.json({ id }, 201);
    })
    .post("/exchange", validateJson(exchangeSchema), (c) => {
      const { code, verifier, redirectUri } = c.req.valid("json");
      const token = signIns.exchange({ kind: "cli", code, verifier, redirectUri });

      if (!token) {
        throw new AppError({
          code: "unauthorized",
          message: "This sign-in code is invalid or expired. Run artil auth login again.",
        });
      }

      return c.json({ token });
    });
}
