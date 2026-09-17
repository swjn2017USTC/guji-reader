/**
 * Anchor offsets are Unicode code points (Python-native), but JS strings are
 * indexed in UTF-16 code units. The corpus contains non-BMP characters
 * (e.g. U+23C30), so these two coordinate systems genuinely diverge and every
 * anchor measured in Python must be converted before slicing in the browser.
 */

export function toUtf16Index(text: string, codePointIndex: number): number {
  if (codePointIndex <= 0) {
    return 0;
  }
  let utf16 = 0;
  let codePoints = 0;
  for (const character of text) {
    if (codePoints >= codePointIndex) {
      break;
    }
    utf16 += character.length;
    codePoints += 1;
  }
  return utf16;
}

export function sliceByCodePoints(text: string, start: number, end: number): string {
  return text.slice(toUtf16Index(text, start), toUtf16Index(text, end));
}

/**
 * Inverse of ``toUtf16Index``: convert a UTF-16 index (what the Selection API
 * reports) into a code-point offset (what every anchor stores).
 */
export function toCodePointIndex(text: string, utf16Index: number): number {
  if (utf16Index <= 0) {
    return 0;
  }
  let utf16 = 0;
  let codePoints = 0;
  for (const character of text) {
    if (utf16 >= utf16Index) {
      break;
    }
    utf16 += character.length;
    codePoints += 1;
  }
  return codePoints;
}

export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) {
    count += 1;
  }
  return count;
}

export type Interval<T> = {
  start: number;
  end: number;
  data: T;
};

export type AnchorRange = {
  start: number;
  end: number;
  exact: string;
};

/**
 * Whether a stored anchor still describes the canonical text it was taken from.
 *
 * Anchors are validated before rendering, not only when they are created: a
 * re-import can shift the text (Wikisource revisions change), and an anchor
 * whose `exact` no longer matches would otherwise decorate the wrong characters
 * with no signal at all. Offsets are code points on both sides.
 */
export function anchorMatches(text: string, anchor: AnchorRange): boolean {
  if (anchor.start < 0 || anchor.end <= anchor.start) {
    return false;
  }
  if (anchor.end > codePointLength(text)) {
    return false;
  }
  return sliceByCodePoints(text, anchor.start, anchor.end) === anchor.exact;
}

export type Segment<T> = {
  start: number;
  end: number;
  text: string;
  covering: T[];
};

/**
 * Split `text` at every interval boundary and report, for each atomic slice,
 * which intervals cover it. Boundaries are code-point offsets.
 *
 * Overlapping intervals are handled by construction: a slice is only ever
 * subdivided at boundaries, so the covering set is constant across a slice.
 */
export function segmentByIntervals<T>(text: string, intervals: Interval<T>[]): Segment<T>[] {
  const length = codePointLength(text);
  const usable = intervals.filter(
    (interval) => interval.end > interval.start && interval.start >= 0 && interval.end <= length,
  );
  if (usable.length === 0) {
    return [{ start: 0, end: length, text, covering: [] }];
  }

  const boundaries = new Set<number>([0, length]);
  for (const interval of usable) {
    boundaries.add(interval.start);
    boundaries.add(interval.end);
  }

  const ordered = [...boundaries].sort((a, b) => a - b);
  const segments: Segment<T>[] = [];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const start = ordered[i];
    const end = ordered[i + 1];
    if (end <= start) {
      continue;
    }
    segments.push({
      start,
      end,
      text: sliceByCodePoints(text, start, end),
      covering: usable.filter(
        (interval) => interval.start <= start && interval.end >= end,
      ).map((interval) => interval.data),
    });
  }
  return segments;
}
