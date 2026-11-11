import { Channel, type SendOptions } from "@artil/channels/contract";

// The Message URL, on which the server's accounts write to each other. It has no provider: what one
// account sends, it hands to the server to deliver to the other, under the id it gives the message.
export class UrlChannel extends Channel {
  readonly kind = "url";

  readonly name = "Message URL";

  readonly labels = { address: "account id", contact: "account name or id" };

  override readonly limits = { recipients: 1, text: 2000, files: 10 };

  async send({ message: { from, to, text, files, replyTo }, deliver }: SendOptions) {
    const id = crypto.randomUUID();

    // The account that sends signed in to send it, so the server vouches for it.
    await deliver({
      id,
      from: { address: from, name: null, username: null, verified: true },
      to,
      text,
      files,
      replyTo,
    });

    return { id };
  }
}
