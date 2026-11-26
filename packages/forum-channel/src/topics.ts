import { z } from "zod";

import type { ChannelState } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import { readJson } from "./json";

// A topic: its number, its title, and who takes part in it, whom its new posts wake.
const topicSchema = z.object({
  number: z.string(),
  title: z.string(),
  participants: z.array(z.string()),
});

export type Topic = z.infer<typeof topicSchema>;

type OpenOptions = Pick<Topic, "title" | "participants">;

type JoinOptions = { topic: Topic; accounts: readonly string[] };

// The forum's topics, which it keeps in the state the server gives it.
export function createTopics(state: ChannelState) {
  function keep(topic: Topic) {
    state.write(`topic:${topic.number}`, JSON.stringify(topic));

    return topic;
  }

  return {
    get(number: string) {
      const topic = readJson({ state, key: `topic:${number}`, schema: topicSchema });

      if (!topic) {
        throw new AppError({
          code: "not_found",
          message: `There is no topic ${number} on the forum`,
        });
      }

      return topic;
    },

    // A new topic, under the next number.
    open({ title, participants }: OpenOptions) {
      const number = readJson({ state, key: "next-topic", schema: z.int() }) ?? 1;

      state.write("next-topic", JSON.stringify(number + 1));

      return keep({ number: String(number), title, participants: [...new Set(participants)] });
    },

    // Makes the accounts take part in the topic, whose new posts wake them from then on.
    join: ({ topic, accounts }: JoinOptions) =>
      keep({ ...topic, participants: [...new Set(topic.participants).union(new Set(accounts))] }),
  };
}

export type Topics = ReturnType<typeof createTopics>;
