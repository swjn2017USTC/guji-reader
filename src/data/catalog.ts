import { workSchema, type Work } from "../types/corpus";

let cachedCatalog: Work | null = null;

/** Test seam: drop the cached catalog so a fresh fetch is issued. */
export function resetCatalogCache(): void {
  cachedCatalog = null;
}

export async function loadCatalog(): Promise<Work> {
  if (cachedCatalog) {
    return cachedCatalog;
  }
  const response = await fetch("/data/catalog.json");
  if (!response.ok) {
    throw new Error(`Failed to load catalog: ${response.status}`);
  }
  const data = await response.json();
  cachedCatalog = workSchema.parse(data);
  return cachedCatalog;
}
