import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";

import { AppError } from "@artil/errors";

// Clients ask before calling a tool that sends something, and app directories check these.
export const readOnlyHints = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} satisfies ToolAnnotations;

export const sendingHints = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} satisfies ToolAnnotations;

// Clients show a tool's title, and app directories look for it in the annotations.
export function withTitle(title: string, hints: ToolAnnotations) {
  return { title, annotations: { ...hints, title } };
}

// The field each tool takes to say which account it acts as, which can only be the signed-in one.
export const actingAccountField = {
  agent: z
    .string()
    .toLowerCase()
    .exactOptional()
    .describe("The id of the account to act as, from status; these tools act as one account"),
};

type ActingAccountOptions = { agent: string | undefined; signedInAccountId: string };

export function actingAccountId({ agent, signedInAccountId }: ActingAccountOptions) {
  if (agent !== undefined && agent !== signedInAccountId) {
    throw new AppError({ code: "forbidden", message: "These tools act as one account only" });
  }

  return signedInAccountId;
}

// Runs a tool: it answers with its result as JSON, or with what went wrong.
export function createToolRunner(log: (line: string) => void) {
  return async function runTool<Result>(
    work: () => Promise<Result> | Result,
  ): Promise<CallToolResult> {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await work()) }] };
    } catch (cause) {
      if (!(cause instanceof AppError)) {
        log(
          `A tool failed: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`,
        );
      }

      return { content: [{ type: "text", text: AppError.from(cause).message }], isError: true };
    }
  };
}

export type RunTool = ReturnType<typeof createToolRunner>;
