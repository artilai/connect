import { Channel, type OutboundMessage, type SendOptions } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

import { createTopics, type Topics } from "./topics";
import { countWake } from "./wakes";

const topicPattern = /^#?(?<number>[1-9]\d{0,9})$/v;

// The server hands a topic over as #13, so an account id made of digits never reads as a topic.
const topicMark = "#";

// @ and an account's name or id, like @codex, where it starts a word, so an email address is none.
const mentionPattern = /(?<![\p{L}\p{N}_.@])@(?<account>[\p{L}\p{N}_\-]+(?:\.[\p{L}\p{N}_\-]+)*)/gv;

const titleLength = 240;

type Recipients = { topics: string[]; accounts: string[] };

function invalid(message: string) {
  return new AppError({ code: "invalid_input", message });
}

function readRecipients(to: readonly string[]): Recipients {
  const named = Object.groupBy(to, (recipient) =>
    recipient.startsWith(topicMark) ? "topics" : "accounts",
  );

  const topics = (named.topics ?? []).map((topic) => topic.slice(topicMark.length));

  return { topics: [...new Set(topics)], accounts: named.accounts ?? [] };
}

function mentionsIn(text: string) {
  return new Set(text.matchAll(mentionPattern).map((match) => match.groups?.account ?? ""));
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

// The number of the topic a post goes in: the topic of the post it answers, or the one it names.
function topicNumberOf({ thread }: OutboundMessage, { topics }: Recipients) {
  if (thread && topics.some((number) => number !== thread)) {
    throw invalid("An answer stays in the topic of the post it answers");
  }

  if (topics.length > 1) throw invalid("A post goes in one topic");

  return thread ?? topics[0];
}

type OpenOrJoinOptions = {
  topics: Topics;
  topic: string | undefined;
  message: OutboundMessage;
  accounts: string[];
};

// The topic the post goes in, which takes part the accounts it calls, or a new one for them.
function openOrJoin({ topics, topic, message, accounts }: OpenOrJoinOptions) {
  if (!topic) return topics.open({ title: titleOf(message), participants: accounts });

  if (message.subject) throw invalid("Only a new topic takes a subject");

  return topics.join({ topic: topics.get(topic), accounts });
}

// Topics every account reads. A post wakes everyone who posted in its topic or was called to it, by
// to or by a mention.
export class ForumChannel extends Channel {
  readonly kind = "forum";

  readonly name = "Forum";

  readonly labels = { address: "account id", contact: "topic number or account name" };

  override readonly limits = { recipients: 10, text: 32_000, files: 10 };

  override readonly subjects = true;

  override readonly shared = true;

  override parseSender(_input: string) {
    return null;
  }

  override parseRecipient(input: string) {
    const number = topicPattern.exec(input.trim())?.groups?.number;

    return number ? `${topicMark}${number}` : null;
  }

  async send({ message, state, addressOf, deliver }: SendOptions) {
    const { from, text, files, replyTo } = message;
    const recipients = readRecipients(message.to);
    const mentioned = [...mentionsIn(text)].flatMap((account) => addressOf(account) ?? []);

    const topic = openOrJoin({
      topics: createTopics(state),
      topic: topicNumberOf(message, recipients),
      message,
      accounts: [from, ...recipients.accounts, ...mentioned],
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
