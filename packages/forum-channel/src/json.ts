import type { z } from "zod";

import type { ChannelState } from "@artil/channels/contract";

type ReadJsonOptions<Schema extends z.ZodType> = {
  state: ChannelState;
  key: string;
  schema: Schema;
};

export function readJson<Schema extends z.ZodType>({
  state,
  key,
  schema,
}: ReadJsonOptions<Schema>): z.output<Schema> | undefined {
  const kept = state.read(key);

  return kept === null ? undefined : schema.parse(JSON.parse(kept));
}
