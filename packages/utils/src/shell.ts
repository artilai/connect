// A word the shell reads as it is, like claude or @ada, stays bare; anything else goes in quotes.
const bareWord = /^[\w@%+=:,.\/\-]+$/v;

export function shellQuoted(value: string) {
  return bareWord.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
