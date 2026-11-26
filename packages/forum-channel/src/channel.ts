import { Channel, type OutboundMessage, type SendOptions } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import { createTopics, type Topics } from "./topics";
import { countWake } from "./wakes";

const everyone = "@everyone";

const topicPattern = /^#?(?<number>[1-9]\d{0,9})$/v;

// The server hands a topic over as #13, so an account id made of digits never reads as a topic.
const topicMark = "#";

const titleLength = 240;

type Recipients = { everyone: boolean; topics: string[]; accounts: string[] };

type TopicForOptions = { topics: Topics; recipients: Recipients; message: OutboundMessage };

function invalid(message: string) {
  return new AppError({ code: "invalid_input", message });
}

function readRecipients(to: readonly string[]): Recipients {
  const named = Object.groupBy(to, (recipient) => {
    if (recipient === everyone) return "everyone";

    return recipient.startsWith(topicMark) ? "topics" : "accounts";
  });

  const topics = (named.topics ?? []).map((topic) => topic.slice(topicMark.length));

  return {
    everyone: Boolean(named.everyone),
    topics: [...new Set(topics)],
    accounts: named.accounts ?? [],
  };
}

function titleOf({ subject, text }: OutboundMessage) {
  const title = subject?.trim() || text.trim().split("\n", 1)[0]?.trim();

  if (!title) {
    throw invalid(
      "A new topic takes a title: give a subject, or start the post with a line of text",
    );
  }

  return title.length > titleLength ? `${title.slice(0, titleLength - 1)}…` : title;
}

// The topic of the post it answers, the topic it names, or a new one.
function topicFor({ topics, recipients, message }: TopicForOptions) {
  const { thread, subject, from } = message;
  const accounts = [from, ...recipients.accounts];

  if (thread && (recipients.everyone || recipients.topics.some((number) => number !== thread))) {
    throw invalid(
      "An answer stays in the topic of the post it answers. Name in to only the accounts to call.",
    );
  }

  if (recipients.topics.length > 1) throw invalid("A post goes in one topic");

  const number = thread ?? recipients.topics[0];

  if (!number) return topics.open({ title: titleOf(message), participants: accounts });

  if (recipients.everyone) {
    throw invalid(`@everyone starts a new topic. Leave it out to post in topic ${number}.`);
  }

  if (subject) throw invalid("Only a new topic takes a subject");

  return topics.join({ topic: topics.get(number), accounts });
}

// Topics every account reads. A post wakes everyone who posted in its topic or was called to it.
export class ForumChannel extends Channel {
  readonly kind = "forum";

  readonly name = "Forum";

  readonly labels = { address: "account id", contact: "topic number, account name or @everyone" };

  override readonly limits = { recipients: 10, text: 32_000, files: 10 };

  override readonly subjects = true;

  override readonly shared = true;

  override parseSender(_input: string) {
    return null;
  }

  override parseRecipient(input: string) {
    const trimmed = input.trim();

    if (trimmed.toLowerCase() === everyone) return everyone;

    const number = topicPattern.exec(trimmed)?.groups?.number;

    return number ? `${topicMark}${number}` : null;
  }

  async send({ message, state, deliver }: SendOptions) {
    const { from, text, files, replyTo } = message;

    const topic = topicFor({
      topics: createTopics(state),
      recipients: readRecipients(message.to),
      message,
    });

    const woken = topic.participants.filter(
      (account) => account !== from && countWake({ state, from, to: account }),
    );

    const id = crypto.randomUUID();

    await deliver({
      id,
      from: { address: from, name: null, username: null, verified: true },
      to: woken,
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
