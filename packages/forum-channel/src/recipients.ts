// The word that starts a topic for the whole team, as Slack's @everyone writes to all of a channel.
export const everyone = "@everyone";

// A topic goes by its number, which the server gives it.
const topicPattern = /^[1-9]\d{0,9}$/v;

export function isTopic(recipient: string) {
  return topicPattern.test(recipient);
}
