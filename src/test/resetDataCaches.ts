import { resetAnnotationsCache } from "../data/annotations";
import { resetCatalogCache } from "../data/catalog";
import { resetSourceNotesCache } from "../data/sourceNotes";
import { resetVolumeCache } from "../data/volume";

/**
 * The corpus loaders memoise their results at module scope, which is correct at
 * runtime (the data is immutable per session) but leaks across tests in one
 * file. Any test that serves different payloads per case must call this first.
 */
export function resetDataCaches(): void {
  resetCatalogCache();
  resetVolumeCache();
  resetSourceNotesCache();
  resetAnnotationsCache();
}
