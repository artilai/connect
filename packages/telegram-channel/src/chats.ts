// A bot's username is 5 to 32 letters, digits and underscores, ending in "bot".
const botUsername = /^@?([a-z][a-z0-9_]{1,28}bot)$/iv;

// A person's username is 4 to 32 letters, digits and underscores, starting with a letter.
const personUsername = /^@?([a-z][a-z0-9_]{3,31})$/iv;

// Telegram matches usernames in any case, so Artil keeps them in lowercase after an @.
export function atUsername(username: string) {
  return `@${username.toLowerCase()}`;
}

// A bot writes to a person at their private chat's id, which is their user id, to a group at its
// id, which is below zero, and to another bot at its @username.
export function readChat(value: string) {
  const chat = value.trim();

  if (/^-?\d{1,20}$/v.test(chat)) return chat;

  const bot = botUsername.exec(chat)?.[1];

  return bot ? atUsername(bot) : undefined;
}

// Who may wake an agent is listed the way a bot writes to them, or a person by their @username. A
// group on the list lets in everyone in it.
export function readSender(value: string) {
  const person = personUsername.exec(value.trim())?.[1];

  return readChat(value) ?? (person && atUsername(person));
}
