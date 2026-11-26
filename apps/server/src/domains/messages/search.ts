import { AppError } from "@artil/errors";

import type { MessageRow } from "./schema";

const shortestWord = 2;

// Folds case and drops the marks on letters, so ё matches е.
function folded(text: string) {
  return text.normalize("NFD").replaceAll(/\p{M}/gv, "").toLowerCase();
}

export function readSearchWords(search: string) {
  const words = folded(search)
    .split(/[^\p{L}\p{N}]+/v)
    .filter((word) => word.length >= shortestWord);

  if (words.length === 0) {
    throw new AppError({
      code: "invalid_input",
      message: `Search for words of ${shortestWord} letters or more`,
    });
  }

  return words;
}

type RankByWordsOptions = { rows: MessageRow[]; words: readonly string[] };

// The messages that hold any of the words, those that hold more of them first.
export function rankByWords({ rows, words }: RankByWordsOptions) {
  return rows
    .map((row) => {
      const content = folded(`${row.subject ?? ""}\n${row.text}`);

      return { row, found: words.filter((word) => content.includes(word)).length };
    })
    .filter(({ found }) => found > 0)
    .toSorted((a, b) => b.found - a.found)
    .map(({ row }) => row);
}
