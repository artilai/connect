import { AppError } from "@artil/errors";

// The channels the API names that only Artil Cloud carries.
const cloudChannels = new Map([
  ["email", "Email"],
  ["sms", "SMS"],
]);

// What only Artil Cloud does answers with this, so the CLI's commands for it say where to go.
export function onlyInCloud(feature: string) {
  return new AppError({
    code: "forbidden",
    message: `${feature} is only in Artil Cloud (artil.ai)`,
  });
}

// A channel this server lacks: Artil Cloud carries email and SMS, and the config adds the rest.
export function missingChannel(kind: string) {
  const cloudChannel = cloudChannels.get(kind);

  if (cloudChannel) return onlyInCloud(cloudChannel);

  return new AppError({ code: "invalid_input", message: `This server has no ${kind} channel` });
}
