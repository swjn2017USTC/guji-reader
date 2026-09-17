import { flip, offset, shift } from "@floating-ui/react";

/**
 * Placement policy shared by the selection toolbar and every reader popover.
 *
 * Kept in one place because the two call sites drifted once already, and the
 * failure is silent: the panel renders, just somewhere the user cannot reach.
 *
 * `shift` runs with `mainAxis: true`. Without it, shift only slides the panel
 * along the cross axis, so a reference with a tall box overflows the viewport
 * edge along the main axis and `flip` cannot rescue it — neither "below" nor
 * "above" fits, so it gives up and leaves the panel off-screen.
 *
 * That is the normal case in vertical mode, not an edge case: a selection
 * spanning several columns has a full-height bounding box (measured: 777px tall
 * in a 945px viewport), which put 標記 / 寫批註 at y=994 and out of reach. The
 * same applies to a personal mark long enough to fill the column.
 */
export const PANEL_MIDDLEWARE = [
  offset(8),
  flip({ padding: 8 }),
  shift({ padding: 8, mainAxis: true, crossAxis: true }),
];
