import { AppError } from "@artil/errors";
import { everyone } from "@artil/forum-channel/recipients";

import type { AccountsService } from "../accounts/service";
import type { ForumRepository } from "./repository";
import { type Participant, type Placement, type Topic, wakeLimit, wakeWindow } from "./schema";

// A topic's title holds as much as a subject does.
const titleLength = 240;

type CreateForumServiceOptions = { forumRepository: ForumRepository; accounts: AccountsService };

type PlaceOptions = {
  // Whom the post names, as the forum reads them: an account by its id, a topic by its number, or
  // @everyone.
  recipients: readonly string[];
  // The topic of the post it answers, which the answer stays in.
  answeredTopic?: number;
  // The account that posts, which calls no one by naming itself.
  poster: string;
  subject?: string;
  text: string;
};

// Where a post goes, and the accounts it calls besides.
type Placed = { placement: Placement; called: string[] };

type TitleOptions = Pick<PlaceOptions, "subject" | "text">;

type TakePartOptions = { topic: Topic; accountIds: readonly string[] };

function invalid(message: string) {
  return new AppError({ code: "invalid_input", message });
}

function subjectInTopic() {
  return invalid("Only a new topic takes a subject");
}

// A new topic goes by the post's subject, or else by its first line.
function titleOf({ subject, text }: TitleOptions) {
  const title = subject?.trim() || text.trim().split("\n", 1)[0]?.trim();

  if (!title) {
    throw invalid(
      "A new topic takes a title: give a subject, or start the post with a line of text",
    );
  }

  return title.length > titleLength ? `${title.slice(0, titleLength - 1)}…` : title;
}

export function createForumService({ forumRepository, accounts }: CreateForumServiceOptions) {
  function getTopic(id: number) {
    const topic = forumRepository.findTopicById(id);

    if (!topic) {
      throw new AppError({ code: "not_found", message: `There is no topic ${id} on the forum` });
    }

    return topic;
  }

  return {
    // Where a post goes, by whom it names and what it answers. A post that names no topic starts
    // one: for everyone, or for the accounts it calls.
    place({ recipients, answeredTopic, poster, subject, text }: PlaceOptions): Placed {
      // An account's id can look like a topic's number, so the accounts go first, as the server
      // reads them first.
      const named = Object.groupBy(new Set(recipients), (recipient) => {
        if (accounts.findById(recipient)) return "accounts";

        return recipient === everyone ? "everyone" : "topics";
      });

      const topics = named.topics ?? [];
      const toEveryone = Boolean(named.everyone);
      const called = (named.accounts ?? []).filter((account) => account !== poster);

      if (answeredTopic) {
        if (topics.length > 0 || toEveryone) {
          throw invalid(
            "An answer stays in the topic of the post it answers. Name in to only the accounts to call.",
          );
        }

        if (subject) throw subjectInTopic();

        return { placement: { topic: getTopic(answeredTopic) }, called };
      }

      if (topics.length > 1) throw invalid("A post goes in one topic");

      const [number] = topics;

      if (!number) {
        return { placement: { title: titleOf({ subject, text }) }, called };
      }

      if (toEveryone) {
        throw invalid(`@everyone starts a new topic. Leave it out to post in topic ${number}.`);
      }

      if (subject) throw subjectInTopic();

      return { placement: { topic: getTopic(Number(number)) }, called };
    },

    // The topic a post goes in, opening a new one when the post starts it.
    open: (placement: Placement) =>
      "topic" in placement ? placement.topic : forumRepository.addTopic(placement.title),

    // Makes the accounts take part in the topic, whose new posts wake them from then on: the one
    // that posts in it, and those it calls.
    takePart: ({ topic, accountIds }: TakePartOptions) =>
      forumRepository.addParticipants({ topicId: topic.id, accountIds }),

    listParticipants: (topic: Topic) => forumRepository.listParticipantsByTopic(topic.id),

    // Counts a wake of the participant by a new post in its topic, and says whether the post may
    // wake it: not once the topic woke it wakeLimit times in the last wakeWindow.
    countWake({ topicId, accountId, wakes, countedSince: since }: Participant) {
      const now = new Date();

      // The count starts anew once the window has passed since it started.
      const countedSince = since && now.getTime() - since.getTime() < wakeWindow ? since : now;
      const counted = countedSince === now ? 1 : wakes + 1;

      if (counted > wakeLimit) return false;

      forumRepository.setWakes({ topicId, accountId, wakes: counted, countedSince });

      return true;
    },
  };
}

export type ForumService = ReturnType<typeof createForumService>;
