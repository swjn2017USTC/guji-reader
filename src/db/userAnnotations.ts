/**
 * Personal annotations live in IndexedDB, never in the corpus.
 *
 * Rule 3 keeps canonical text immutable and rule 4 keeps source/AI/user layers
 * distinguishable; both are enforced here by storing user annotations in a
 * separate database that nothing else writes to. There is no cloud sync in
 * V0.1 — this database is strictly local to the browser profile.
 */

import Dexie, { type Table } from "dexie";
import { userAnnotationSchema, type UserAnnotation } from "../types/corpus";

export const DB_NAME = "guji-reader";

class GujiReaderDatabase extends Dexie {
  userAnnotations!: Table<UserAnnotation, string>;

  constructor() {
    super(DB_NAME);
    // Only top-level fields are indexed. passageId lives inside the anchor, and
    // per-work volume counts are small enough to filter in memory rather than
    // depend on nested-key indexing.
    this.version(1).stores({
      userAnnotations: "id, workId, updatedAt",
    });
  }
}

let database: GujiReaderDatabase | null = null;

export function getDatabase(): GujiReaderDatabase {
  if (!database) {
    database = new GujiReaderDatabase();
  }
  return database;
}

/** Test seam: drop the cached connection so a fresh fake IndexedDB is used. */
export function resetDatabaseConnection(): void {
  database?.close();
  database = null;
}

export type UserAnnotationDraft = {
  workId: string;
  editionId: string;
  anchor: UserAnnotation["anchor"];
  style: UserAnnotation["style"];
  color: string;
  opacity: number;
  note: string;
};

function newId(): string {
  return `ua:${crypto.randomUUID()}`;
}

export async function createUserAnnotation(
  draft: UserAnnotationDraft,
): Promise<UserAnnotation> {
  const now = new Date().toISOString();
  const record: UserAnnotation = {
    id: newId(),
    workId: draft.workId,
    editionId: draft.editionId,
    anchor: draft.anchor,
    style: draft.style,
    color: draft.color,
    opacity: draft.opacity,
    note: draft.note,
    createdAt: now,
    updatedAt: now,
  };
  await getDatabase().userAnnotations.add(record);
  return record;
}

export async function updateUserAnnotation(
  id: string,
  changes: Partial<Pick<UserAnnotation, "style" | "color" | "opacity" | "note">>,
): Promise<UserAnnotation | null> {
  const table = getDatabase().userAnnotations;
  const existing = await table.get(id);
  if (!existing) {
    return null;
  }
  const updated: UserAnnotation = {
    ...existing,
    ...changes,
    updatedAt: new Date().toISOString(),
  };
  await table.put(updated);
  return updated;
}

export async function deleteUserAnnotation(id: string): Promise<void> {
  await getDatabase().userAnnotations.delete(id);
}

export async function importUserAnnotations(annotations: UserAnnotation[]): Promise<void> {
  if (annotations.length > 0) {
    await getDatabase().userAnnotations.bulkAdd(annotations);
  }
}

/**
 * Load every annotation for a work.
 *
 * Records that no longer satisfy the schema are dropped rather than thrown: a
 * corrupt row must not make the reader unopenable.
 */
export async function loadUserAnnotations(workId: string): Promise<UserAnnotation[]> {
  const rows = await getDatabase().userAnnotations.where("workId").equals(workId).toArray();
  return rows.flatMap((row) => {
    const parsed = userAnnotationSchema.safeParse(row);
    if (!parsed.success) {
      console.warn("Dropping malformed user annotation", row.id, parsed.error.message);
      return [];
    }
    return [parsed.data];
  });
}

export function annotationsForPassage(
  annotations: UserAnnotation[],
  passageId: string,
): UserAnnotation[] {
  return annotations.filter((annotation) => annotation.anchor.passageId === passageId);
}
