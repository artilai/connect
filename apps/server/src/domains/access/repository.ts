import { and, eq } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { access } from "../../platform/db/schema";
import type { ChannelKind } from "../channels/schema";
import { type Access, defaultAccess } from "./schema";

type ChannelOptions = { agentId: string; channel: ChannelKind };

type SenderOptions = ChannelOptions & { sender: string };

export function createAccessRepository(db: Database) {
  function read({ agentId, channel }: ChannelOptions): Access {
    const row = db
      .select({ admit: access.admit, senders: access.senders })
      .from(access)
      .where(and(eq(access.agentId, agentId), eq(access.channel, channel)))
      .get();

    return row ?? defaultAccess;
  }

  function write(options: ChannelOptions, { admit, senders }: Access) {
    db.insert(access)
      .values({ ...options, admit, senders })
      .onConflictDoUpdate({ target: [access.agentId, access.channel], set: { admit, senders } })
      .run();
  }

  return {
    read,

    // A sender on the list wakes the agent whoever else does.
    addSender: ({ sender, ...options }: SenderOptions) => {
      const current = read(options);

      if (current.senders.includes(sender)) return false;

      write(options, { ...current, senders: [...current.senders, sender] });

      return true;
    },

    removeSender: ({ sender, ...options }: SenderOptions) => {
      const current = read(options);

      if (!current.senders.includes(sender)) return false;

      write(options, {
        ...current,
        senders: current.senders.filter((listed) => listed !== sender),
      });

      return true;
    },
  };
}

export type AccessRepository = ReturnType<typeof createAccessRepository>;
