import { and, eq } from "drizzle-orm";

import type { Database } from "../../platform/db/connection";
import { access } from "../../platform/db/schema";
import type { ChannelKind } from "../channels/schema";
import { type Access, type Admit, defaultAccess } from "./schema";

type ChannelOptions = { accountId: string; channel: ChannelKind };

type SetAdmitOptions = ChannelOptions & { admit: Admit };

type SenderOptions = ChannelOptions & { sender: string };

type RemoveSenderEverywhereOptions = { channel: ChannelKind; sender: string };

// A transaction a change of the lists runs in.
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type WriteSendersOptions = ChannelOptions & { tx: Transaction; senders: string[] };

// Holds the database's write lock from a change's first read on, so a change another process makes
// to the lists meanwhile waits for it rather than is undone by it.
const immediate = { behavior: "immediate" } as const;

function ofList({ accountId, channel }: ChannelOptions) {
  return and(eq(access.accountId, accountId), eq(access.channel, channel));
}

// Writes the list's senders and nothing else of it, like who wakes the agent beside them.
function writeSenders({ tx, accountId, channel, senders }: WriteSendersOptions) {
  tx.insert(access)
    .values({ accountId, channel, admit: defaultAccess.admit, senders })
    .onConflictDoUpdate({ target: [access.accountId, access.channel], set: { senders } })
    .run();
}

function readSenders(tx: Transaction, options: ChannelOptions) {
  const row = tx.select({ senders: access.senders }).from(access).where(ofList(options)).get();

  return row?.senders ?? defaultAccess.senders;
}

export function createAccessRepository(db: Database) {
  return {
    read: (options: ChannelOptions): Access =>
      db
        .select({ admit: access.admit, senders: access.senders })
        .from(access)
        .where(ofList(options))
        .get() ?? defaultAccess,

    // Anyone, the team beside the list, or only the list wakes the agent; the list stays as it is,
    // whatever a command writes to it meanwhile.
    setAdmit: ({ admit, ...options }: SetAdmitOptions) =>
      db
        .insert(access)
        .values({ ...options, admit, senders: defaultAccess.senders })
        .onConflictDoUpdate({ target: [access.accountId, access.channel], set: { admit } })
        .run(),

    // A sender on the list wakes the agent whoever else does.
    addSender: ({ sender, ...options }: SenderOptions) =>
      db.transaction((tx) => {
        const senders = readSenders(tx, options);

        if (senders.includes(sender)) return false;

        writeSenders({ tx, ...options, senders: [...senders, sender] });

        return true;
      }, immediate),

    removeSender: ({ sender, ...options }: SenderOptions) =>
      db.transaction((tx) => {
        const senders = readSenders(tx, options);

        if (!senders.includes(sender)) return false;

        writeSenders({ tx, ...options, senders: senders.filter((listed) => listed !== sender) });

        return true;
      }, immediate),

    // Takes the sender off every account's list on the channel.
    removeSenderEverywhere: ({ channel, sender }: RemoveSenderEverywhereOptions) =>
      db.transaction((tx) => {
        const lists = tx
          .select({ accountId: access.accountId, senders: access.senders })
          .from(access)
          .where(eq(access.channel, channel))
          .all();

        for (const { accountId, senders } of lists) {
          if (!senders.includes(sender)) continue;

          const kept = senders.filter((listed) => listed !== sender);

          writeSenders({ tx, accountId, channel, senders: kept });
        }
      }, immediate),
  };
}

export type AccessRepository = ReturnType<typeof createAccessRepository>;
