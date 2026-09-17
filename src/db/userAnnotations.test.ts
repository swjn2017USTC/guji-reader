import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  annotationsForPassage,
  createUserAnnotation,
  deleteUserAnnotation,
  getDatabase,
  loadUserAnnotations,
  resetDatabaseConnection,
  updateUserAnnotation,
  type UserAnnotationDraft,
} from "./userAnnotations";
import type { UserAnnotation } from "../types/corpus";

const WORK_ID = "test-work";
const PASSAGE_ID = `${WORK_ID}:vol01:p1`;

function draft(overrides: Partial<UserAnnotationDraft> = {}): UserAnnotationDraft {
  return {
    workId: WORK_ID,
    editionId: "test-edition",
    anchor: {
      passageId: PASSAGE_ID,
      start: 0,
      end: 2,
      exact: "周威",
      prefix: "",
      suffix: "烈王",
    },
    style: "highlight",
    color: "#f5c542",
    opacity: 0.28,
    note: "",
    ...overrides,
  };
}

describe("user annotation storage", () => {
  beforeEach(async () => {
    resetDatabaseConnection();
    await indexedDB.deleteDatabase("guji-reader");
  });

  afterEach(() => {
    resetDatabaseConnection();
  });

  it("saves and reloads an annotation", async () => {
    const created = await createUserAnnotation(draft());
    expect(created.id).toMatch(/^ua:/);
    expect(created.createdAt).toBe(created.updatedAt);

    const loaded = await loadUserAnnotations(WORK_ID);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].anchor.exact).toBe("周威");
    expect(loaded[0].opacity).toBe(0.28);
  });

  it("keeps highlight and wavy on the same shape", async () => {
    await createUserAnnotation(draft({ style: "highlight", opacity: 0.28 }));
    await createUserAnnotation(
      draft({ style: "wavy", opacity: 0.75, anchor: { ...draft().anchor, start: 3, end: 4 } }),
    );

    const loaded = await loadUserAnnotations(WORK_ID);
    expect(loaded).toHaveLength(2);
    // Only style/opacity differ; both go through identical storage.
    expect(loaded.map((item) => item.style).sort()).toEqual(["highlight", "wavy"]);
  });

  it("updates note and style, refreshing updatedAt", async () => {
    const created = await createUserAnnotation(draft());
    const updated = await updateUserAnnotation(created.id, {
      note: "此處指周威烈王。",
      style: "wavy",
    });

    expect(updated).not.toBeNull();
    expect(updated!.note).toBe("此處指周威烈王。");
    expect(updated!.style).toBe("wavy");
    expect(updated!.anchor).toEqual(created.anchor);
    expect(updated!.createdAt).toBe(created.createdAt);

    const loaded = await loadUserAnnotations(WORK_ID);
    expect(loaded[0].note).toBe("此處指周威烈王。");
  });

  it("returns null when updating a missing record", async () => {
    expect(await updateUserAnnotation("ua:missing", { note: "x" })).toBeNull();
  });

  it("deletes an annotation", async () => {
    const created = await createUserAnnotation(draft());
    await deleteUserAnnotation(created.id);
    expect(await loadUserAnnotations(WORK_ID)).toHaveLength(0);
  });

  it("scopes loading to a single work", async () => {
    await createUserAnnotation(draft());
    await createUserAnnotation(draft({ workId: "other-work" }));
    const loaded = await loadUserAnnotations(WORK_ID);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].workId).toBe(WORK_ID);
  });

  it("drops malformed rows instead of failing the whole read", async () => {
    const good = await createUserAnnotation(draft());
    // Corrupt a required field the way a schema change or manual edit might.
    await getDatabase().userAnnotations.put({
      ...good,
      id: "ua:corrupt",
      opacity: 5,
    } as unknown as UserAnnotation);

    const loaded = await loadUserAnnotations(WORK_ID);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(good.id);
    expect(loaded[0].opacity).toBe(0.28);
  });

  it("groups annotations by passage", async () => {
    const a = await createUserAnnotation(draft());
    const b = await createUserAnnotation(
      draft({ anchor: { ...draft().anchor, passageId: `${WORK_ID}:vol01:p2` } }),
    );
    const loaded = await loadUserAnnotations(WORK_ID);
    expect(annotationsForPassage(loaded, PASSAGE_ID).map((item) => item.id)).toEqual([a.id]);
    expect(
      annotationsForPassage(loaded, `${WORK_ID}:vol01:p2`).map((item) => item.id),
    ).toEqual([b.id]);
  });
});
