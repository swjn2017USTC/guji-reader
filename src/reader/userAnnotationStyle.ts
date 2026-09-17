/**
 * Shared visual vocabulary for personal annotations.
 *
 * highlight and wavy are the same data model with different defaults, per
 * plan §7.1/§7.4: highlight 0.28 opacity, wavy 0.75.
 */

import type { UserAnnotation } from "../types/corpus";

/** Ten fixed colours. Kept short, medium-luminance and distinguishable on all three themes. */
export const USER_COLORS = [
  "#f5c542",
  "#e8883a",
  "#e05c5c",
  "#d16ba5",
  "#9b6dd6",
  "#5c8ee0",
  "#3aa9b8",
  "#4caf7d",
  "#8fae4a",
  "#9e8b7a",
] as const;

export type UserColor = (typeof USER_COLORS)[number];

export const DEFAULT_HIGHLIGHT_OPACITY = 0.28;
export const DEFAULT_WAVY_OPACITY = 0.75;

export const USER_STYLE_LABEL: Record<UserAnnotation["style"], string> = {
  highlight: "高亮",
  wavy: "波浪線",
};

export function defaultOpacity(style: UserAnnotation["style"]): number {
  return style === "wavy" ? DEFAULT_WAVY_OPACITY : DEFAULT_HIGHLIGHT_OPACITY;
}

/** Normalise a stored colour to rgba with the record's opacity applied. */
export function withOpacity(color: string, opacity: number): string {
  const clamped = Math.min(1, Math.max(0, opacity));
  const hex = color.trim().replace("#", "");
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((character) => character + character)
          .join("")
      : hex;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    // Unknown format: fall back to the accent colour rather than emitting
    // invalid CSS that would silently drop the decoration.
    return `rgba(139, 90, 43, ${clamped})`;
  }

  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}
