/**
 * Selection → TextAnchor conversion.
 *
 * Two things make this non-trivial:
 *
 * 1. Passage text is rendered as many nested spans (proper-name lines, AI
 *    annotations, 古注). A DOM position therefore has to be mapped back onto
 *    canonical text offsets by walking the text nodes in order.
 * 2. The 注 / 批 badges live inside the passage element but are UI, not
 *    canonical text. They are skipped, otherwise every offset after a badge
 *    would be off by one.
 *
 * Offsets are Unicode code points, matching every other anchor in the project.
 * The corpus contains non-BMP characters, so this is load-bearing.
 */

import type { Passage, TextAnchor } from "../types/corpus";
import { codePointLength, sliceByCodePoints, toCodePointIndex, toUtf16Index } from "./anchors";

export const PASSAGE_ATTRIBUTE = "data-passage-id";
export const UI_MARKER_ATTRIBUTE = "data-ui-marker";

/** Width of the stored prefix/suffix context, in code points. */
export const CONTEXT_WINDOW = 8;

export type SelectionFailure =
  | "empty"
  | "outside-passage"
  | "cross-passage"
  | "stale";

export type SelectionAnchorResult =
  | { ok: true; anchor: TextAnchor; rect: DOMRect }
  | { ok: false; reason: SelectionFailure };

export function findPassageElement(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>(`[${PASSAGE_ATTRIBUTE}]`) ?? null;
}

function isUiMarker(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(`[${UI_MARKER_ATTRIBUTE}]`) !== null;
}

/**
 * Count the code points of canonical text that precede ``(container, offset)``
 * inside ``passageElement``. Returns ``null`` when the position is not inside
 * the passage or falls inside a UI marker, which has no canonical offset.
 */
export function domPositionToCodePoint(
  passageElement: HTMLElement,
  container: Node,
  offset: number,
): number | null {
  if (!passageElement.contains(container)) {
    return null;
  }
  if (container === passageElement) {
    return 0;
  }
  if (isUiMarker(container)) {
    return null;
  }

  const walker = document.createTreeWalker(passageElement, NodeFilter.SHOW_TEXT);
  let count = 0;
  let node = walker.nextNode();
  while (node) {
    if (isUiMarker(node)) {
      node = walker.nextNode();
      continue;
    }
    if (node === container) {
      // Inside this text node: count only the part before `offset`.
      return count + toCodePointIndex(node.nodeValue ?? "", offset);
    }
    count += codePointLength(node.nodeValue ?? "");
    node = walker.nextNode();
  }
  return null;
}

export function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Convert the current selection into a verified anchor.
 *
 * V0.1 restricts a selection to a single passage (rule 8); a selection touching
 * two passages is rejected rather than silently clipped.
 */
export function selectionToAnchor(
  selection: Selection | null,
  findPassageByElement: (element: HTMLElement) => Passage | undefined,
): SelectionAnchorResult {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return { ok: false, reason: "empty" };
  }

  const range = selection.getRangeAt(0);
  const startPassage = findPassageElement(range.startContainer);
  const endPassage = findPassageElement(range.endContainer);

  if (!startPassage || !endPassage) {
    return { ok: false, reason: "outside-passage" };
  }
  if (startPassage !== endPassage) {
    return { ok: false, reason: "cross-passage" };
  }

  const passage = findPassageByElement(startPassage);
  if (!passage) {
    return { ok: false, reason: "stale" };
  }

  const start = domPositionToCodePoint(startPassage, range.startContainer, range.startOffset);
  const end = domPositionToCodePoint(startPassage, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) {
    return { ok: false, reason: "empty" };
  }

  const length = codePointLength(passage.text);
  if (end > length) {
    // DOM text and canonical text disagree — refuse rather than store a bad anchor.
    return { ok: false, reason: "stale" };
  }

  const anchor: TextAnchor = {
    passageId: passage.id,
    start,
    end,
    exact: sliceByCodePoints(passage.text, start, end),
    prefix: passage.text.slice(
      toUtf16Index(passage.text, Math.max(0, start - CONTEXT_WINDOW)),
      toUtf16Index(passage.text, start),
    ),
    suffix: passage.text.slice(
      toUtf16Index(passage.text, end),
      toUtf16Index(passage.text, Math.min(length, end + CONTEXT_WINDOW)),
    ),
  };

  if (!anchorMatchesText(anchor, passage.text)) {
    return { ok: false, reason: "stale" };
  }

  // jsdom (and some embedded webviews) do not implement
  // Range.getBoundingClientRect; a missing rect must not lose the anchor.
  const rect =
    typeof range.getBoundingClientRect === "function"
      ? range.getBoundingClientRect()
      : new DOMRect(0, 0, 0, 0);

  return { ok: true, anchor, rect };
}

/** Fail loudly if an anchor no longer matches the canonical text. */
export function anchorMatchesText(anchor: TextAnchor, passageText: string): boolean {
  if (anchor.start < 0 || anchor.end <= anchor.start) {
    return false;
  }
  if (anchor.end > codePointLength(passageText)) {
    return false;
  }
  return sliceByCodePoints(passageText, anchor.start, anchor.end) === anchor.exact;
}
