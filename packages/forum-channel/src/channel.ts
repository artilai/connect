import { Channel, type OutboundMessage, type SendOptions } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import { createTopics, type Topics } from "./topics";
import { countWake } from "./wakes";

// The word that starts a topic for the whole team, as Slack's @everyone writes to all of a channel.
const everyone = "@everyone";

// A topic goes by its number, which a person may write with a # before it.
const topicPattern = /^#?(?<number>[1-9]\d{0,9})$/v;

// The server hands a topic over with the # before its number, so an account's id, which can be all
// digits, never reads as a topic.
const topicMark = "#";

// A topic's title holds as much as a subject does.
const titleLength = 240;

type Recipients = { everyone: boolean; topics: Set<string>; accounts: string[] };

type TopicNumberOptions = { recipients: Recipients; thread: string | undefined };

type TopicForOptions = {
  topics: Topics;
  recipients: Recipients;
  message: OutboundMessage;
};

function invalid(message: string) {
  return new AppError({ code: "invalid_input", message });
}

// Whom a post names, as the server hands them over: everyone, topics by their marked numbers, and
// accounts by their ids.
function readRecipients(to: readonly string[]): Recipients {
  const named = Object.groupBy(to, (recipient) => {
    if (recipient === everyone) return "everyone";

    return recipient.startsWith(topicMark) ? "topics" : "accounts";
  });

  return {
    everyone: Boolean(named.everyone),
    topics: new Set(named.topics?.map((topic) => topic.slice(topicMark.length))),
    accounts: named.accounts ?? [],
  };
}

// A new topic goes by the post's subject, or else by its first line.
function titleOf({ subject, text }: OutboundMessage) {
  const title = subject?.trim() || text.trim().split("\n", 1)[0]?.trim();

  if (!title) {
    throw invalid(
      "A new topic takes a title: give a subject, or start the post with a line of text",
    );
  }

  return title.length > titleLength ? `${title.slice(0, titleLength - 1)}…` : title;
}

// The number of the topic a post goes in: the one of the post it answers, which the server gives as
// its thread, or the one it names, or none for a post that starts a topic.
function topicNumberOf({ recipients, thread }: TopicNumberOptions) {
  if (thread) {
    if (recipients.everyone || recipients.topics.difference(new Set([thread])).size > 0) {
      throw invalid(
        "An answer stays in the topic of the post it answers. Name in to only the accounts to call.",
      );
    }

    return thread;
  }

  if (recipients.topics.size > 1) throw invalid("A post goes in one topic");

  const [number] = recipients.topics;

  if (number && recipients.everyone) {
    throw invalid(`@everyone starts a new topic. Leave it out to post in topic ${number}.`);
  }

  return number;
}

// The topic a post goes in, which the poster and the accounts it calls take part in from then on: a
// topic it answers or names, or else a new one, for everyone or for the accounts it calls.
function topicFor({ topics, recipients, message }: TopicForOptions) {
  const number = topicNumberOf({ recipients, thread: message.thread });
  const accounts = [message.from, ...recipients.accounts];

  if (!number) return topics.open({ title: titleOf(message), participants: accounts });

  if (message.subject) throw invalid("Only a new topic takes a subject");

  return topics.join({ topic: topics.get(number), accounts });
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

  // A new topic goes by its subject, and every post by its topic's title.
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

    const number = topicPattern.exec(trimmed)?.groups?.number;

    return number ? `${topicMark}${number}` : null;
  }

  async send({ message, state, deliver }: SendOptions) {
    const { from, text, files, replyTo } = message;
    const recipients = readRecipients(message.to);
    const topic = topicFor({ topics: createTopics(state), recipients, message });
    const id = crypto.randomUUID();

    // The account that posts signed in to post, so the server vouches for it.
    await deliver({
      id,
      from: { address: from, name: null, username: null, verified: true },
      to: topic.participants.filter(
        (account) => account !== from && countWake({ state, from, to: account }),
      ),
      group: { address: topic.number, name: topic.title },
      subject: topic.title,
      text,
      files,
      replyTo,
      thread: topic.number,
    });

    return { id };
  }
}
