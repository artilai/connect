// Slack names everything by an id of capital letters and digits: a person by one that starts with
// U, or W in an Enterprise Grid org, a channel by one that starts with C or G, and a direct message
// by one that starts with D.
const personId = /^[UW][A-Z0-9]{8,}$/v;

const channelId = /^[CG][A-Z0-9]{8,}$/v;

export function isPerson(id: string) {
  return personId.test(id);
}

export function isDirectMessage(id: string) {
  return id.startsWith("D");
}

// A person by their member id, or a channel by its id: whom a bot writes to, in a direct message
// for a person, and who may wake an agent, where a channel lets in everyone in it.
export function readContact(value: string) {
  const id = value.trim().toUpperCase();

  return personId.test(id) || channelId.test(id) ? id : undefined;
}
