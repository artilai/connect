import { z } from "zod";

// Slack names everything by an id of capital letters and digits: a person by one that starts with
// U, or W in an Enterprise Grid org, a channel by one that starts with C or G, and a direct message
// by one that starts with D. Artil names them as people do where Slack tells how: a person by their
// email, a bot by its @username and a channel by its #name.
const personId = /^[UW][A-Z0-9]{8,}$/v;

const channelId = /^[CG][A-Z0-9]{8,}$/v;

// A channel's name is lowercase letters, digits, dashes and underscores.
const channelName = /^#[\p{Ll}\p{N}_\-]{1,80}$/v;

export function isPerson(id: string) {
  return personId.test(id);
}

export function isEmail(value: string) {
  return z.email().safeParse(value).success;
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

// Who may wake an agent: a person by their email or member id, or everyone in a channel by its
// #name, the ways a message from them is named.
export function readSender(value: string) {
  const sender = value.trim();
  const lowercase = sender.toLowerCase();

  if (isEmail(lowercase) || channelName.test(lowercase)) return lowercase;

  return personId.test(sender.toUpperCase()) ? sender.toUpperCase() : null;
}

// Whom a bot writes to: anyone a list names, or a channel by its id, in a direct message for a
// person.
export function readRecipient(value: string) {
  const id = value.trim().toUpperCase();

  return readSender(value) ?? (channelId.test(id) ? id : null);
}
