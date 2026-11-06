import { z } from "zod";

export type ConnectionRecord = {
  id: string;
  tokenId: string;
  client: string;
  machine: string | null;
  startsAfter: number;
};

export const connectionSchema = z
  .object({
    id: z.uuid(),
    client: z.string(),
    machine: z.string().nullable(),
    tokenId: z.uuid().meta({ description: "The agent's token the client connected with" }),
  })
  .meta({ id: "Connection" });

type Connection = z.infer<typeof connectionSchema>;

export function toConnection({ id, client, machine, tokenId }: ConnectionRecord): Connection {
  return { id, client, machine, tokenId };
}
