import {
  publishedVolumeAnnotationsSchema,
  type PublishedVolumeAnnotations,
} from "../types/annotations";

const empty = (workId: string, volumeId: string): PublishedVolumeAnnotations => ({
  workId,
  volumeId,
  annotations: [],
  properNames: [],
});

const cache = new Map<string, PublishedVolumeAnnotations>();

/**
 * Published annotations are optional per volume. In dev the SPA fallback answers
 * unknown paths with index.html and status 200, so a content-type check is what
 * actually distinguishes "no annotations yet" from a real payload.
 */
export async function loadPublishedAnnotations(
  workId: string,
  volumeId: string,
): Promise<PublishedVolumeAnnotations> {
  const key = `${workId}/${volumeId}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const response = await fetch(`/data/annotations/${workId}/${volumeId}.json`);
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 404 || contentType.includes("text/html")) {
    const blank = empty(workId, volumeId);
    cache.set(key, blank);
    return blank;
  }
  if (!response.ok) {
    throw new Error(`Failed to load annotations for ${volumeId}: ${response.status}`);
  }

  const parsed = publishedVolumeAnnotationsSchema.parse(await response.json());
  cache.set(key, parsed);
  return parsed;
}
