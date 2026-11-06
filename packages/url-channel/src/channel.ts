import type { Channel, OutboundFile } from "@artil/channels/contract";
import { AppError } from "@artil/errors";

// A message on the Message URL holds up to 2000 characters and 10 files.
export const maxUrlText = 2000;

const maxUrlFiles = 10;

// The threads a message goes between: the one of the sender's client it comes from, and the one
// of the agent's client it is for. A thread is whatever a client calls its conversation, like a
// Codex thread id.
export type UrlData = {
  thread: string | null;
  toThread: string | null;
  // The client the sender writes in, like Codex, which the agent sees beside the sender's name.
  client: string | null;
};

// A message from one agent to another, which the Message URL hands over whole.
export type UrlDelivery = UrlData & {
  from: string;
  to: string;
  text: string | null;
  files: OutboundFile[];
};

// Whoever carries the Message URL: it decides whether the agent takes the message, hands it to
// the agent's listening client, and returns the message's id.
export type UrlChannelHost = { deliver: (delivery: UrlDelivery) => Promise<string> };

const noThreads = { thread: null, toThread: null, client: null } satisfies UrlData;

function invalid(message: string) {
  return new AppError({ code: "invalid_input", message });
}

// The Message URL: an agent writes to another, and the message goes whole to whoever listens to
// that agent.
export function createUrlChannel(host: UrlChannelHost) {
  return {
    kind: "url",
    name: "Message URL",
    recipients: "the id of one agent from team.list",

    send: async ({ from, to, cc, text, files, channelData = noThreads }) => {
      const [recipient, ...others] = to;

      if (recipient === undefined || others.length > 0) {
        throw invalid("Put the id of the one agent to send to in to");
      }

      if (cc.length > 0) throw invalid("A message on url copies no one");

      if (text.length > maxUrlText) {
        throw invalid(`A message on url holds at most ${maxUrlText} characters`);
      }

      if (files.length > maxUrlFiles) {
        throw invalid(`A message on url carries at most ${maxUrlFiles} files`);
      }

      // Without a thread, an agent writing to itself would only answer itself.
      if (from === recipient && channelData.thread === null) {
        throw invalid(
          "An agent cannot send to its own Message URL, except from a thread to another",
        );
      }

      const messageId = await host.deliver({
        from,
        to: recipient,
        text: text || null,
        files,
        ...channelData,
      });

      return { externalId: messageId };
    },
  } satisfies Channel<"url", UrlData>;
}
