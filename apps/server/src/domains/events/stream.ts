import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import { second } from "@artil/utils/time";

import type { AccountEnv } from "../accounts/schema";
import { createNotifier } from "./notifier";
import type { Event, EventRecord } from "./schema";
import type { EventsService } from "./service";

const checkInInterval = 30 * second;

// The CLI gives up on a stream that stays quiet for 20 seconds.
const heartbeatInterval = 5 * second;

type StreamEventsOptions = {
  c: Context<AccountEnv>;
  events: EventsService;
  // What a client sees of an event.
  toClientEvent: (event: EventRecord) => Event;
  resumeAfter: number;
  // Says whether the stream may go on, given the last event it sent; once not, the stream ends.
  checkIn: (cursor: number) => boolean;
};

export function streamEvents({
  c,
  events,
  toClientEvent,
  resumeAfter,
  checkIn,
}: StreamEventsOptions) {
  const accountId = c.var.account.id;

  return streamSSE(c, async (stream) => {
    const notifier = createNotifier();
    const unsubscribe = events.subscribe(accountId, () => notifier.notify());

    stream.onAbort(() => notifier.notify());

    try {
      let cursor = resumeAfter;
      let unread = true;
      let checkedInAt = 0;

      while (!stream.aborted) {
        if (unread || Date.now() - checkedInAt >= checkInInterval) {
          if (!checkIn(cursor)) break;

          checkedInAt = Date.now();
        }

        if (unread) {
          const page = events.listAfter({ accountId, cursor });

          for (const event of page) {
            await stream.writeSSE({
              id: String(event.id),
              event: event.type,
              data: JSON.stringify(toClientEvent(event)),
            });
            cursor = event.id;
          }

          if (page.length > 0) continue;
        }

        unread = await notifier.wait(heartbeatInterval);

        if (!unread) await stream.write(": heartbeat\n\n");
      }
    } finally {
      unsubscribe();
    }
  });
}
