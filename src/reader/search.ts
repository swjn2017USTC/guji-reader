import type { Passage } from "../types/corpus";

export type SearchMatch = {
  passageId: string;
  start: number;
  end: number;
  ordinal: number;
};

/** Find non-overlapping, code-point-safe matches in passage order. */
export function findSearchMatches(
  passages: Pick<Passage, "id" | "text">[],
  query: string,
): SearchMatch[] {
  const needle = Array.from(query.trim().toLocaleLowerCase());
  if (needle.length === 0) {
    return [];
  }

  const matches: SearchMatch[] = [];
  for (const passage of passages) {
    const haystack = Array.from(passage.text.toLocaleLowerCase());
    for (let start = 0; start <= haystack.length - needle.length; start += 1) {
      if (needle.every((character, offset) => haystack[start + offset] === character)) {
        matches.push({
          passageId: passage.id,
          start,
          end: start + needle.length,
          ordinal: matches.length,
        });
        start += needle.length - 1;
      }
    }
  }
  return matches;
}
