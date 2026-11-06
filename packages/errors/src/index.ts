import { z } from "zod/mini";

const errorCodeSchema = z.enum([
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "internal",
  "unavailable",
]);

type ErrorCode = z.infer<typeof errorCodeSchema>;

const statuses = {
  invalid_input: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
  unavailable: 503,
} as const satisfies Record<ErrorCode, number>;

export const errorBodySchema = z.object({
  error: z.object({ code: errorCodeSchema, message: z.string() }),
});

type ErrorBody = z.infer<typeof errorBodySchema>;

type AppErrorOptions = {
  code: ErrorCode;
  message: string;
  cause?: unknown;
};

export class AppError extends Error {
  override name = "AppError";

  readonly code: ErrorCode;

  readonly status: (typeof statuses)[ErrorCode];

  constructor({ code, message, ...options }: AppErrorOptions) {
    super(message, options);
    this.code = code;
    this.status = statuses[code];
  }

  static from(cause: unknown) {
    if (cause instanceof AppError) return cause;

    return new AppError({ code: "internal", message: "Something went wrong", cause });
  }

  toJSON(): ErrorBody {
    return { error: { code: this.code, message: this.message } };
  }

  getResponse() {
    return Response.json(this.toJSON(), { status: this.status });
  }
}

export function messageOf(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}
