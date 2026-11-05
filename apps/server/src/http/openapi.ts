import type { Env, Hono } from "hono";
import { generateSpecs, resolver } from "hono-openapi";
import type { Schema } from "hono/types";

import { errorBodySchema } from "@artil/errors";

type ResponseSchema = Parameters<typeof resolver>[0];

export function jsonResponse(description: string, schema: ResponseSchema) {
  return { description, content: { "application/json": { schema: resolver(schema) } } };
}

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// Every error is a 4XX or 5XX status with the same body, named so clients can type it.
const failure = {
  description: "The request failed; the error says why",
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
};

const failures = { "4XX": failure, "5XX": failure };

const options = {
  documentation: {
    info: {
      title: "Artil server API",
      version: "1.0.0",
      description:
        "The part of the Artil API a self-hosted Artil server answers, with the same paths and shapes, so the artil CLI and its plugins work with it.",
    },
    servers: [{ url: "http://localhost:4747/api" }],
    components: { securitySchemes: { token: { type: "http" as const, scheme: "bearer" } } },
    security: [{ token: [] }],
  },
  defaultOptions: Object.fromEntries(methods.map((method) => [method, { responses: failures }])),
  defaultValidationErrorResponse: false,
};

export async function describeApi<E extends Env, S extends Schema, P extends string>(
  api: Hono<E, S, P>,
) {
  const [specs, error] = await Promise.all([
    generateSpecs(api, options),
    resolver(errorBodySchema).toOpenAPISchema(),
  ]);

  return {
    ...specs,
    components: {
      ...specs.components,
      schemas: { ...specs.components.schemas, Error: error.schema },
    },
  };
}
