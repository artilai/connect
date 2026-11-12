// Slack names everything by an id of capital letters and digits: a person by one that starts with
// U, or W in an Enterprise Grid org, a channel by one that starts with C or G, and a direct message
// by one that starts with D.
const personId = /^[UW][A-Z0-9]{8,}$/v;

const channelId = /^[CG][A-Z0-9]{8,}$/v;

const directMessageId = /^D[A-Z0-9]{8,}$/v;

export function isPerson(id: string) {
  return personId.test(id);
}

// A bot writes to a person by their member id, in a direct message, and to a channel or a direct
// message by its id.
export function readRecipient(value: string) {
  const id = value.trim().toUpperCase();

  return personId.test(id) || channelId.test(id) || directMessageId.test(id) ? id : undefined;
}

// Who may wake an agent is listed by their member id. A channel on the list lets in everyone in it.
export function readSender(value: string) {
  const id = value.trim().toUpperCase();

  return personId.test(id) || channelId.test(id) ? id : undefined;
}
