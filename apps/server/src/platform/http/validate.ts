import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { resolver, uniqueSymbol } from "hono-openapi";
import { type ZodType, z } from "zod";

import { AppError } from "@artil/errors";

export function validateJson<Schema extends ZodType>(schema: Schema) {
  return documented({
    target: "json",
    schema,
    middleware: zValidator("json", schema, (result) => {
      if (!result.success) throw invalid(result.error);
    }),
  });
}

export function validateQuery<Schema extends ZodType>(schema: Schema) {
  return documented({
    target: "query",
    schema,
    middleware: zValidator("query", schema, (result) => {
      if (!result.success) throw invalid(result.error);
    }),
  });
}

const uuid = z.uuid();

const printable = /^[^\p{Cc}\p{Cf}]+$/v;

// A label a person or a client gives, which the server passes on as it is: a name, a thread, a
// machine.
export function labelSchema(name: string, max: number) {
  return z
    .string()
    .trim()
    .min(1, `${name} cannot be empty`)
    .max(max, `${name} must be at most ${max} characters`)
    .regex(printable, `${name} cannot hold control characters`);
}

export function readId(value: string | undefined) {
  const parsed = uuid.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

type DocumentedOptions<Middleware> = {
  target: keyof ValidationTargets;
  schema: ZodType;
  middleware: Middleware;
};

// Marks a middleware with the schema it validates, so the OpenAPI document describes it.
export function documented<Middleware extends object>({
  target,
  schema,
  middleware,
}: DocumentedOptions<Middleware>) {
  return Object.assign(middleware, { [uniqueSymbol]: { target, ...resolver(schema) } });
}

export function invalid(error: z.core.$ZodError) {
  const messages = error.issues.flatMap((issue) =>
    issue.code === "invalid_key" ? issue.issues.map((nested) => nested.message) : [issue.message],
  );

  return new AppError({ code: "invalid_input", message: messages.join("; ") });
}
