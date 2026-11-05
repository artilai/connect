import { Hono } from "hono";
import { z } from "zod";

import { AppError } from "@artil/errors";

import type { FileLinks } from "./links";
import type { FilesService } from "./service";

const signedSchema = z.object({ exp: z.coerce.number().int(), sig: z.string().min(1) });

type CreateFileRoutesOptions = { files: FilesService; fileLinks: FileLinks };

// A signed link downloads a file with no sign-in until it expires.
export function createFileRoutes({ files, fileLinks }: CreateFileRoutesOptions) {
  return new Hono().get("/:id", async (c) => {
    const fileId = c.req.param("id");
    const linkQuery = signedSchema.safeParse(c.req.query());

    const signatureValid =
      linkQuery.success &&
      fileLinks.verify({ fileId, expiresAt: linkQuery.data.exp, signature: linkQuery.data.sig });

    const storedFile = signatureValid ? await files.read(fileId) : undefined;

    if (!storedFile) {
      throw new AppError({ code: "not_found", message: "The file is gone or the link expired" });
    }

    const { file, content } = storedFile;

    return c.body(new Uint8Array(content), 200, {
      "Content-Type": file.type,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
    });
  });
}
