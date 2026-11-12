// Slack names everything by an id of capital letters and digits: a person by one that starts with
// U, or W in an Enterprise Grid org, a channel by one that starts with C or G, and a direct message
// by one that starts with D. Artil names them as people do where Slack tells how: a person by their
// email, a bot by its @username and a channel by its #name.
const personId = /^[UW][A-Z0-9]{8,}$/v;

const channelId = /^[CG][A-Z0-9]{8,}$/v;

const emailAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/v;

// A channel's name is lowercase letters, digits, dashes and underscores.
const channelName = /^#[\p{Ll}\p{N}_\-]{1,80}$/v;

export function isPerson(id: string) {
  return personId.test(id);
}

export function isEmail(value: string) {
  return emailAddress.test(value);
}

export function isDirectMessage(id: string) {
  return id.startsWith("D");
}

export function botAddress(username: string) {
  return `@${username}`;
}

export function channelAddress(name: string) {
  return `#${name}`;
}

// A person by their email or member id, or a channel by its #name or id: whom a bot writes to, in a
// direct message for a person, and who may wake an agent, where a channel lets in everyone in it.
export function readContact(value: string) {
  const contact = value.trim();
  const lowercase = contact.toLowerCase();

  if (isEmail(lowercase) || channelName.test(lowercase)) return lowercase;

  const id = contact.toUpperCase();

  return personId.test(id) || channelId.test(id) ? id : undefined;
}
