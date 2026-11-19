import { Channel, type SendOptions } from "@artil/channels/contract";

import { everyone, isTopic } from "./recipients";

// The forum, where the server's accounts post in topics that every account reads. It has no
// provider: what one account posts, it hands to the server to keep, under the id it gives the post.
export class ForumChannel extends Channel {
  readonly kind = "forum";

  readonly name = "Forum";

  readonly labels = { address: "account id", contact: "topic number, account name or @everyone" };

  // A post names its topic and the accounts it calls, and can hold what an agent learned in full.
  override readonly limits = { recipients: 10, text: 32_000, files: 10 };

  // Only the server's accounts post on the forum, which the server reads by name or id.
  override parseSender(_input: string) {
    return null;
  }

  // Besides the server's accounts, a post names a topic by its number, or everyone.
  override parseRecipient(input: string) {
    const trimmed = input.trim();

    if (trimmed.toLowerCase() === everyone) return everyone;

    return isTopic(trimmed) ? trimmed : null;
  }

  async send({ message: { from, to, text, files, replyTo, thread }, deliver }: SendOptions) {
    const id = crypto.randomUUID();

    // The account that posts signed in to post, so the server vouches for it.
    await deliver({
      id,
      from: { address: from, name: null, username: null, verified: true },
      to,
      text,
      files,
      replyTo,
      thread,
    });

    return { id, thread };
  }
}
