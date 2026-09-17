import { sourceNoteSchema, type SourceNote } from "../types/corpus";

const cache = new Map<string, SourceNote[]>();

/** Test seam: drop cached source notes so fresh fetches are issued. */
export function resetSourceNotesCache(): void {
  cache.clear();
}

export async function loadSourceNotes(
  workId: string,
  volumeId: string,
): Promise<SourceNote[]> {
  const key = `${workId}/${volumeId}`;
  if (cache.has(key)) {
    return cache.get(key)!;
  }
  const response = await fetch(`/data/source_notes/${workId}/${volumeId}.json`);
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 404 || contentType.includes("text/html")) {
    cache.set(key, []);
    return [];
  }
  if (!response.ok) {
    throw new Error(`Failed to load source notes for ${volumeId}: ${response.status}`);
  }
  const data = await response.json();
  const notes = data.map((n: unknown) => sourceNoteSchema.parse(n));
  cache.set(key, notes);
  return notes;
}
