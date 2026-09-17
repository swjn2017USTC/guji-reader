import { passageSchema, type Passage } from "../types/corpus";

const cache = new Map<string, Passage[]>();

/** Test seam: drop cached volumes so fresh fetches are issued. */
export function resetVolumeCache(): void {
  cache.clear();
}

export async function loadVolume(workId: string, volumeId: string): Promise<Passage[]> {
  const key = `${workId}/${volumeId}`;
  if (cache.has(key)) {
    return cache.get(key)!;
  }
  const response = await fetch(`/data/works/${workId}/${volumeId}.json`);
  if (!response.ok) {
    throw new Error(`Failed to load volume ${volumeId}: ${response.status}`);
  }
  const data = await response.json();
  const passages = data.map((p: unknown) => passageSchema.parse(p));
  cache.set(key, passages);
  return passages;
}
