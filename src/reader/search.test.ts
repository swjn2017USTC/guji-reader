import { describe, expect, it } from "vitest";
import { findSearchMatches } from "./search";

describe("findSearchMatches", () => {
  const passages = [
    { id: "p1", text: "周威烈王二十三年" },
    { id: "p2", text: "魏斯者，魏桓子之孫也。" },
  ];

  it("finds non-overlapping matches in passage order", () => {
    expect(findSearchMatches([{ id: "p1", text: "甲甲甲" }], "甲甲")).toEqual([
      { passageId: "p1", start: 0, end: 2, ordinal: 0 },
    ]);
  });

  it("is case-insensitive for Latin text and code-point safe", () => {
    expect(findSearchMatches([{ id: "p1", text: "𣰰 AbC" }], "abc")).toEqual([
      { passageId: "p1", start: 2, end: 5, ordinal: 0 },
    ]);
  });

  it("returns matches across passages and ignores blank queries", () => {
    expect(findSearchMatches(passages, "魏")).toEqual([
      { passageId: "p2", start: 0, end: 1, ordinal: 0 },
      { passageId: "p2", start: 4, end: 5, ordinal: 1 },
    ]);
    expect(findSearchMatches(passages, "   ")).toEqual([]);
  });
});
