import { z } from "zod";

import type { ChannelState } from "@artil/channels/contract";
import { AppError } from "@artil/errors";
import { minute } from "@artil/utils/time";

// How often one account's posts wake another at most, in one topic or across new ones, so agents
// cannot keep waking each other: what follows waits on the forum until the window has passed.
const wakeLimit = 5;

const wakeWindow = 10 * minute;

// A topic, by its number: its title, and who takes part in it, whom its new posts wake.
const storedTopicSchema = z.object({ title: z.string(), participants: z.array(z.string()) });

export type Topic = z.infer<typeof storedTopicSchema> & { number: string };

// How many times one account's posts woke another since it started counting.
const wakesSchema = z.object({ wakes: z.int(), since: z.int() });

const nextNumberSchema = z.coerce.number().int();

type OpenOptions = { title: string; participants: readonly string[] };

type JoinOptions = { topic: Topic; accounts: readonly string[] };

type CountWakeOptions = { from: string; to: string };

// The forum's topics, which the server keeps for it.
export function createTopics(state: ChannelState) {
  function write(topic: Topic) {
    const { number, ...stored } = topic;

    state.write(`topic:${number}`, JSON.stringify(stored));

    return topic;
  }

  return {
    get(number: string): Topic {
      const stored = state.read(`topic:${number}`);

      if (stored === null) {
        throw new AppError({
          code: "not_found",
          message: `There is no topic ${number} on the forum`,
        });
      }

      return { number, ...storedTopicSchema.parse(JSON.parse(stored)) };
    },

    // A new topic, under the next number.
    open({ title, participants }: OpenOptions) {
      const number = nextNumberSchema.parse(state.read("next-topic") ?? 1);

      state.write("next-topic", String(number + 1));

      return write({ number: String(number), title, participants: [...new Set(participants)] });
    },

    // Makes the accounts take part in the topic, whose new posts wake them from then on.
    join: ({ topic, accounts }: JoinOptions) =>
      write({ ...topic, participants: [...new Set([...topic.participants, ...accounts])] }),

    // Counts a wake of one account by another's post, and says whether the post may wake it: not
    // once the other's posts woke it wakeLimit times in the last wakeWindow.
    countWake({ from, to }: CountWakeOptions) {
      const key = `wakes:${from}:${to}`;
      const stored = state.read(key);
      const counted = stored === null ? undefined : wakesSchema.parse(JSON.parse(stored));
      const now = Date.now();

      // The count starts anew once the window has passed since it started.
      const counting = counted && now - counted.since < wakeWindow;
      const wakes = counting ? counted.wakes + 1 : 1;

      if (wakes > wakeLimit) return false;

      state.write(key, JSON.stringify({ wakes, since: counting ? counted.since : now }));

      return true;
    },
  };
}

export type Topics = ReturnType<typeof createTopics>;
