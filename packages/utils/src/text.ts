const byteUnits = ["B", "KB", "MB", "GB"] as const;

function roundedSize(value: number) {
  return value < 9.95 ? Math.round(value * 10) / 10 : Math.round(value);
}

export function formatBytes(bytes: number) {
  let value = bytes;
  let unit = 0;

  while (unit < byteUnits.length - 1 && roundedSize(value) >= 1000) {
    value /= 1000;
    unit += 1;
  }

  return `${roundedSize(value)} ${byteUnits[unit] ?? "B"}`;
}

// Something a message quotes, by whoever wrote it when that is known.
export type Quote = { fromName: string | null; text: string };

// A message's text under what it quotes, the way an email reply quotes: each quote under who wrote
// it, its lines after "> ".
export function withQuotes(text: string, quotes: readonly Quote[]) {
  const quoted = quotes.map(({ fromName, text: said }) => {
    const lines = said
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

    return fromName ? `${fromName} wrote:\n${lines}` : lines;
  });

  return [...quoted, text].filter(Boolean).join("\n\n");
}
