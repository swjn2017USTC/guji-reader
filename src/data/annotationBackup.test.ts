import { describe, expect, it } from "vitest";
import {
  createAnnotationBackup,
  parseAnnotationBackupText,
} from "./annotationBackup";
import type { UserAnnotation } from "../types/corpus";

const annotation: UserAnnotation = {
  id: "ua:1",
  workId: "work",
  editionId: "edition",
  anchor: { passageId: "work:vol01:p1", start: 0, end: 2, exact: "周威", prefix: "", suffix: "烈王" },
  style: "highlight",
  color: "#f5c542",
  opacity: 0.3,
  note: "魏斯",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("annotation backup", () => {
  it("round-trips a versioned backup and skips duplicate anchors", () => {
    const backup = createAnnotationBackup("work", "edition", [annotation]);
    const result = parseAnnotationBackupText(
      JSON.stringify(backup),
      "work",
      "edition",
      [annotation],
    );
    expect(result.annotations).toEqual([]);
    expect(result.skippedDuplicates).toBe(1);
  });

  it("rejects another edition and malformed JSON", () => {
    const backup = createAnnotationBackup("other", "edition", [annotation]);
    expect(() => parseAnnotationBackupText(JSON.stringify(backup), "work", "edition", [])).toThrow(
      "不屬於目前的作品版本",
    );
    expect(() => parseAnnotationBackupText("{", "work", "edition", [])).toThrow(
      "有效的 JSON",
    );
  });
});
