import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { mockFetch, resetFetchMock } from "./test/mockFetch";
import { resetDatabaseConnection } from "./db/userAnnotations";
import { resetDataCaches } from "./test/resetDataCaches";
import vol01Annotations from "./test/fixtures/vol01_annotations.json";

const PASSAGE_ID = "test-work:vol01:p1";

/** The real canonical text of p1 in the fixture volume. */
const TEXT = "周威烈王二十三年，初命晉大夫魏斯爲諸侯。";

/**
 * An annotation whose `exact` no longer matches the text at [start, end) — what
 * a corpus re-import produces when Wikisource revises a page.
 */
const driftedAnnotation = {
  id: "ai:test-work:vol01:p1:PERSON:0-4",
  workId: "test-work",
  volumeId: "vol01",
  passageId: PASSAGE_ID,
  anchor: {
    passageId: PASSAGE_ID,
    start: 0,
    end: 4,
    exact: "完全不同",
    prefix: "",
    suffix: "",
  },
  layer: 1,
  category: "PERSON",
  text: "這條註釋的 anchor 已經失效。",
  confidence: 0.9,
  source: "reviewer",
};

const driftedProperName = {
  id: "pn:test-work:vol01:p1:PERSON:0-4",
  workId: "test-work",
  volumeId: "vol01",
  passageId: PASSAGE_ID,
  anchor: {
    passageId: PASSAGE_ID,
    start: 0,
    end: 4,
    exact: "也不符合",
    prefix: "",
    suffix: "",
  },
  type: "PERSON",
};

describe("stale anchors", () => {
  beforeEach(async () => {
    localStorage.clear();
    resetDataCaches();
    resetDatabaseConnection();
    await indexedDB.deleteDatabase("guji-reader");
  });

  afterEach(() => {
    resetFetchMock();
    localStorage.clear();
  });

  it("does not decorate text when an anchor no longer matches", async () => {
    mockFetch({
      "/data/annotations/test-work/vol01.json": {
        workId: "test-work",
        volumeId: "vol01",
        annotations: [driftedAnnotation],
        properNames: [driftedProperName],
      },
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("第一卷正文第一段。")).toBeInTheDocument();
    });

    // The passage still renders — only the drifted decorations are withheld.
    const passage = document.querySelector(`[data-passage-id="${PASSAGE_ID}"]`)!;
    expect(passage.textContent).toBe(TEXT);
    // No 注 badge and no 專名線 for the stale records.
    expect(document.querySelectorAll("[data-annotation-marker]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-proper-name-type]")).toHaveLength(0);
  });

  it("still renders well-formed anchors alongside stale ones", async () => {
    mockFetch({
      "/data/annotations/test-work/vol01.json": {
        workId: "test-work",
        volumeId: "vol01",
        annotations: [driftedAnnotation, vol01Annotations.annotations[0]],
        properNames: [driftedProperName],
      },
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("第一卷正文第一段。")).toBeInTheDocument();
    });

    // Exactly the one healthy annotation survives.
    expect(document.querySelectorAll("[data-annotation-marker]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-proper-name-type]")).toHaveLength(0);
  });
});
