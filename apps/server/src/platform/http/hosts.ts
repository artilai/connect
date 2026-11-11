import { createMiddleware } from "hono/factory";

import { AppError } from "@artil/errors";

const loopbackNames = new Set(["localhost", "127.0.0.1", "[::1]"]);

type CreateHostsOptions = {
  // The https address Tailscale Funnel gives the server in public mode.
  publicUrl: string | undefined;
};

// The server answers only at its own addresses, so a site whose name a browser resolves to this
// machine cannot pose as it.
export function createHosts({ publicUrl }: CreateHostsOptions) {
  const parsedPublicUrl = publicUrl ? new URL(publicUrl) : undefined;

  function requestOrigin(request: Request) {
    const host = request.headers.get("host") ?? "";

    if (parsedPublicUrl?.host === host) return parsedPublicUrl.origin;

    const requestedHost = URL.parse(`http://${host}`);

    if (!requestedHost || !loopbackNames.has(requestedHost.hostname)) {
      throw new AppError({
        code: "forbidden",
        message: "This server does not answer at this address",
      });
    }

    return `http://${host}`;
  }

  return {
    requestOrigin,

    check: createMiddleware(async (c, next) => {
      requestOrigin(c.req.raw);
      await next();
    }),
  };
}

export type Hosts = ReturnType<typeof createHosts>;
