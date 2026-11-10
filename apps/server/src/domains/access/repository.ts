import { and, eq } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { access } from "../../platform/db/schema";
import type { ChannelKind } from "../channels/schema";
import { type Access, type Admit, defaultAccess } from "./schema";

type ChannelOptions = { accountId: string; channel: ChannelKind };

type SetAdmitOptions = ChannelOptions & { admit: Admit };

type SenderOptions = ChannelOptions & { sender: string };

export function createAccessRepository(db: Database) {
  function read({ accountId, channel }: ChannelOptions): Access {
    const row = db
      .select({ admit: access.admit, senders: access.senders })
      .from(access)
      .where(and(eq(access.accountId, accountId), eq(access.channel, channel)))
      .get();

    return row ?? defaultAccess;
  }

  function write(options: ChannelOptions, { admit, senders }: Access) {
    db.insert(access)
      .values({ ...options, admit, senders })
      .onConflictDoUpdate({ target: [access.accountId, access.channel], set: { admit, senders } })
      .run();
  }

  return {
    read,

    // Anyone, the team beside the list, or only the list wakes the agent; the list stays as it is,
    // whatever a command writes to it meanwhile.
    setAdmit: ({ admit, ...options }: SetAdmitOptions) =>
      db
        .insert(access)
        .values({ ...options, admit, senders: defaultAccess.senders })
        .onConflictDoUpdate({ target: [access.accountId, access.channel], set: { admit } })
        .run(),

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
