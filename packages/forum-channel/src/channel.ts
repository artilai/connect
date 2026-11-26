import { Channel, type SendOptions } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import { createTopics, type Topic, type Topics } from "./topics";

// The word that starts a topic for the whole team, as Slack's @everyone writes to all of a channel.
const everyone = "@everyone";

// A topic goes by its number, which the forum gives it. The server hands it over with a # before
// it, which no account's id has.
const topicPattern = /^[1-9]\d{0,9}$/v;

const topicMark = "#";

// A topic's title holds as much as a subject does.
const titleLength = 240;

type NamedRecipients = { everyone?: string[]; topics?: string[]; accounts?: string[] };

type PlaceOptions = {
  topics: Topics;
  named: NamedRecipients;
  // The topic of the post it answers, which the server gives as its thread.
  thread?: string;
  subject?: string;
  text: string;
};

type TitleOptions = Pick<PlaceOptions, "subject" | "text">;

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

// The topic a post goes in, by whom it names and what it answers, or the title of the one it starts:
// for everyone, or for the accounts it calls.
function place({ topics, named, thread, subject, text }: PlaceOptions): Topic | { title: string } {
  const numbers = new Set((named.topics ?? []).map((topic) => topic.slice(topicMark.length)));
  const toEveryone = Boolean(named.everyone);

  if (thread) {
    if (toEveryone || numbers.difference(new Set([thread])).size > 0) {
      throw invalid(
        "An answer stays in the topic of the post it answers. Name in to only the accounts to call.",
      );
    }

    if (subject) throw subjectInTopic();

    return topics.get(thread);
  }

  if (numbers.size > 1) throw invalid("A post goes in one topic");

  const [number] = numbers;

  if (!number) return { title: titleOf({ subject, text }) };

  if (toEveryone) {
    throw invalid(`@everyone starts a new topic. Leave it out to post in topic ${number}.`);
  }

  if (subject) throw subjectInTopic();

  return topics.get(number);
}

// The forum, where the server's accounts post in topics that every account reads. Whoever posted in
// a topic or was called to it takes part in it, and each new post there wakes them. It has no
// provider: what one account posts, it hands to the server to keep, under the id it gives the post.
export class ForumChannel extends Channel {
  readonly kind = "forum";

  readonly name = "Forum";

  readonly labels = { address: "account id", contact: "topic number, account name or @everyone" };

  // A post names its topic and the accounts it calls, and can hold what an agent learned in full.
  override readonly limits = { recipients: 10, text: 32_000, files: 10 };

  // A new topic goes by its subject.
  override readonly subjects = true;

  override readonly shared = true;

  // Only the server's accounts post on the forum, which the server reads by name or id.
  override parseSender(_input: string) {
    return null;
  }

  // Besides the server's accounts, a post names a topic by its number, or everyone.
  override parseRecipient(input: string) {
    const trimmed = input.trim();

    if (trimmed.toLowerCase() === everyone) return everyone;

    return topicPattern.test(trimmed) ? `${topicMark}${trimmed}` : null;
  }

  async send({ message, state, deliver }: SendOptions) {
    const { from, to, subject, text, files, replyTo, thread } = message;
    const topics = createTopics(state);

    const named: NamedRecipients = Object.groupBy(new Set(to), (recipient) => {
      if (recipient === everyone) return "everyone";

      return recipient.startsWith(topicMark) ? "topics" : "accounts";
    });

    const called = (named.accounts ?? []).filter((account) => account !== from);
    const placed = place({ topics, named, thread, subject, text });
    const accounts = [from, ...called];

    const topic =
      "number" in placed
        ? topics.join({ topic: placed, accounts })
        : topics.open({ title: placed.title, participants: accounts });

    const woken = topic.participants.filter(
      (account) => account !== from && topics.countWake({ from, to: account }),
    );

    const id = crypto.randomUUID();

    // The account that posts signed in to post, so the server vouches for it.
    await deliver({
      id,
      from: { address: from, name: null, username: null, verified: true },
      to: woken,
      group: { address: topic.number, name: topic.title },
      // Every post goes by its topic's title, as an answer to an email keeps its subject.
      subject: topic.title,
      text,
      files,
      replyTo,
      thread: topic.number,
    });

    return { id, thread: topic.number };
  }
}
