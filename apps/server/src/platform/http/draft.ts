import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import { AppError } from "@artil/errors";

import type { Upload } from "../storage";
import { documented, invalid } from "./validate";

const maxUploads = 10;

export const sendBodyLimit = bodyLimit({
  maxSize: 8 * 1024 * 1024,
  onError: () => {
    throw new AppError({
      code: "invalid_input",
      message: "Send at most 8 MiB in one message, files included",
    });
  },
});

const formSchema = z.object({
  draft: z.string().describe("The message as JSON, with the fields of a JSON request"),
  file: z
    .union([z.file(), z.array(z.file()).max(maxUploads, `Send at most ${maxUploads} files`)])
    .optional()
    .describe("The files to send, one part each"),
});

type FormInput = z.input<typeof formSchema>;

const multipart = /^multipart\/form-data/iv;

async function toUpload(file: File): Promise<Upload> {
  const content = new Uint8Array(await file.arrayBuffer());

  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: content.byteLength,
    content,
  };
}

// A message to send comes as JSON, or as multipart form data when files from disk come with it.
// The schema reads the message, and readDraft and draftForm are the middleware that read and
// document both forms.
export function createDraftReader<Schema extends z.ZodType>(schema: Schema) {
  type SendBody = { draft: z.output<Schema>; files: Upload[] };

  function unwrapDraft(draft: z.ZodSafeParseResult<z.output<Schema>>) {
    if (!draft.success) throw invalid(draft.error);

    return draft.data;
  }

  async function readForm(c: Context): Promise<SendBody> {
    const form = formSchema.safeParse(await c.req.parseBody({ all: true }));

    if (!form.success) throw invalid(form.error);

    let json: unknown;

    try {
      json = JSON.parse(form.data.draft);
    } catch (cause) {
      throw new AppError({
        code: "invalid_input",
        message: "draft must be the message as JSON",
        cause,
      });
    }

    return {
      draft: unwrapDraft(schema.safeParse(json)),
      files: await Promise.all([form.data.file ?? []].flat().map(toUpload)),
    };
  }

  async function readJson(c: Context): Promise<SendBody> {
    const json: unknown = await c.req.json().catch((cause: unknown) => {
      throw new AppError({
        code: "invalid_input",
        message: "Malformed JSON in request body",
        cause,
      });
    });

    return { draft: unwrapDraft(schema.safeParse(json)), files: [] };
  }

  // A client sends either json or form. Hono's client types a union of the two as a function it
  // cannot call, so both are optional here.
  type DraftInput = {
    in: { json?: z.input<Schema>; form?: FormInput };
    out: { json: SendBody };
  };

  return {
    readDraft: documented({
      target: "json",
      schema,
      middleware: createMiddleware<object, string, DraftInput>(async (c, next) => {
        const body = multipart.test(c.req.header("content-type") ?? "")
          ? await readForm(c)
          : await readJson(c);

        c.req.addValidatedData("json", body);
        await next();
      }),
    }),

    // Documents the multipart form of a send; readDraft reads it.
    draftForm: documented({
      target: "form",
      schema: formSchema,
      middleware: createMiddleware((_, next) => next()),
    }),
  };
}
