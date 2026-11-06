export function shellQuoted(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
