import { beforeEach, describe, expect, it } from "vitest";
import type { Passage } from "../types/corpus";
import {
  anchorMatchesText,
  domPositionToCodePoint,
  rangesOverlap,
  selectionToAnchor,
} from "./selection";
import { withOpacity, USER_COLORS, defaultOpacity } from "./userAnnotationStyle";

const WORK_ID = "test-work";

function makePassage(text: string, id = `${WORK_ID}:vol01:p1`): Passage {
  return {
    id,
    workId: WORK_ID,
    volumeId: "vol01",
    order: 1,
    text,
    sourcePage: "https://example.com/vol01",
    revisionId: "1",
  };
}

/** Build a DOM mirroring the renderer's nesting and select a text range in it. */
function renderPassage(text: string): { element: HTMLElement; passage: Passage } {
  const passage = makePassage(text);
  const element = document.createElement("p");
  element.setAttribute("data-passage-id", passage.id);
  // Simulates the decoration spans the renderer emits, including a 注 badge
  // that must not contribute to offsets.
  element.innerHTML =
    `<span><span data-proper-name-type="PERSON">${text.slice(0, 2)}</span>` +
    `${text.slice(2, 4)}` +
    `<button data-ui-marker data-annotation-marker="ai:x">注</button>` +
    `<span>${text.slice(4)}</span></span>`;
  document.body.appendChild(element);
  return { element, passage };
}

function selectText(node: Node, start: number, end: number): Selection {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe("selection to anchor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
  });

  it("converts a selection inside one passage", () => {
    const text = "周威烈王二十三年";
    const { element, passage } = renderPassage(text);
    const firstText = element.querySelector("[data-proper-name-type]")!.firstChild!;

    const result = selectionToAnchor(selectText(firstText, 0, 2), () => passage);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.anchor.passageId).toBe(passage.id);
    expect(result.anchor.start).toBe(0);
    expect(result.anchor.end).toBe(2);
    expect(result.anchor.exact).toBe("周威");
    expect(result.anchor.suffix).toBe("烈王二十三年");
    expect(anchorMatchesText(result.anchor, text)).toBe(true);
  });

  it("produces prefix context for a mid-text selection", () => {
    const text = "周威烈王二十三年";
    const { element, passage } = renderPassage(text);
    const firstText = element.querySelector("[data-proper-name-type]")!.firstChild!;

    const result = selectionToAnchor(selectText(firstText, 1, 2), () => passage);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.anchor.start).toBe(1);
    expect(result.anchor.exact).toBe("威");
    expect(result.anchor.prefix).toBe("周");
  });

  it("skips the 注 badge when counting offsets", () => {
    const text = "周威烈王二十三年";
    const { element, passage } = renderPassage(text);
    // Last span holds the tail after the badge.
    const tail = element.lastElementChild!.lastElementChild!.firstChild!;

    const result = selectionToAnchor(selectText(tail, 0, 2), () => passage);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The tail span holds text[4:] and the badge's "注" must not shift it.
    expect(result.anchor.start).toBe(4);
    expect(result.anchor.exact).toBe("二十");
  });

  it("rejects an empty selection", () => {
    const { element, passage } = renderPassage("周威烈王");
    const node = element.querySelector("[data-proper-name-type]")!.firstChild!;
    const range = document.createRange();
    range.setStart(node, 1);
    range.setEnd(node, 1);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const result = selectionToAnchor(selection, () => passage);
    expect(result).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a cross-passage selection", () => {
    const text = "周威烈王二十三年";
    const { element, passage } = renderPassage(text);
    const first = element.querySelector("[data-proper-name-type]")!.firstChild!;

    // Second passage appended after the first.
    const other = document.createElement("p");
    other.setAttribute("data-passage-id", `${WORK_ID}:vol01:p2`);
    other.textContent = "初命晉大夫";
    document.body.appendChild(other);
    const otherPassage = makePassage("初命晉大夫", `${WORK_ID}:vol01:p2`);

    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(other.firstChild!, 2);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const lookup = (element: HTMLElement) =>
      element.getAttribute("data-passage-id") === passage.id ? passage : otherPassage;

    const result = selectionToAnchor(selection, lookup);
    expect(result).toEqual({ ok: false, reason: "cross-passage" });
  });

  it("rejects a selection outside any passage", () => {
    const outside = document.createElement("p");
    outside.textContent = "不屬於任何段落";
    document.body.appendChild(outside);

    const result = selectionToAnchor(
      selectText(outside.firstChild!, 0, 2),
      () => undefined,
    );
    expect(result).toEqual({ ok: false, reason: "outside-passage" });
  });

  it("maps DOM positions to code points across a non-BMP character", () => {
    // U+23C30 is one code point but two UTF-16 units.
    const text = "古文𣰰字";
    const passage = makePassage(text);
    const element = document.createElement("p");
    element.setAttribute("data-passage-id", passage.id);
    element.textContent = text;
    document.body.appendChild(element);

    const node = element.firstChild!;
    expect(domPositionToCodePoint(element, node, 2)).toBe(2);
    // Past the surrogate pair: one code point, two UTF-16 units.
    expect(domPositionToCodePoint(element, node, 4)).toBe(3);
    expect(domPositionToCodePoint(element, node, 5)).toBe(4);

    const result = selectionToAnchor(selectText(node, 2, 4), () => passage);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.anchor.start).toBe(2);
    expect(result.anchor.end).toBe(3);
    expect(result.anchor.exact).toBe("𣰰");
  });
});

describe("overlap detection", () => {
  it("detects intersecting ranges", () => {
    expect(rangesOverlap({ start: 0, end: 5 }, { start: 3, end: 8 })).toBe(true);
    expect(rangesOverlap({ start: 3, end: 8 }, { start: 0, end: 5 })).toBe(true);
    expect(rangesOverlap({ start: 0, end: 9 }, { start: 3, end: 5 })).toBe(true);
  });

  it("treats touching ranges as distinct", () => {
    expect(rangesOverlap({ start: 0, end: 5 }, { start: 5, end: 8 })).toBe(false);
    expect(rangesOverlap({ start: 5, end: 8 }, { start: 0, end: 5 })).toBe(false);
  });

  it("treats the identical range as overlapping", () => {
    expect(rangesOverlap({ start: 2, end: 4 }, { start: 2, end: 4 })).toBe(true);
  });
});

describe("user annotation style helpers", () => {
  it("offers ten fixed colours", () => {
    expect(USER_COLORS).toHaveLength(10);
    expect(new Set(USER_COLORS).size).toBe(10);
  });

  it("uses distinct default opacities per style", () => {
    expect(defaultOpacity("highlight")).toBeCloseTo(0.28);
    expect(defaultOpacity("wavy")).toBeCloseTo(0.75);
  });

  it("converts a hex colour to rgba", () => {
    expect(withOpacity("#f5c542", 0.28)).toBe("rgba(245, 197, 66, 0.28)");
    expect(withOpacity("f5c542", 0.5)).toBe("rgba(245, 197, 66, 0.5)");
    expect(withOpacity("#fff", 1)).toBe("rgba(255, 255, 255, 1)");
  });

  it("clamps opacity and survives an unknown colour format", () => {
    expect(withOpacity("#000000", 5)).toBe("rgba(0, 0, 0, 1)");
    expect(withOpacity("#000000", -1)).toBe("rgba(0, 0, 0, 0)");
    expect(withOpacity("not-a-colour", 0.5)).toBe("rgba(139, 90, 43, 0.5)");
  });
});
