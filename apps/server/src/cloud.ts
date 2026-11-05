import { AppError } from "@artil/errors";

// What only Artil Cloud does answers with this, so the CLI's commands for it say where to go.
export function onlyInCloud(feature: string) {
  return new AppError({
    code: "forbidden",
    message: `${feature} is only in Artil Cloud (artil.ai). This server has Telegram and the Message URL.`,
  });
}
