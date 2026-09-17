import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/*
 * jsdom implements no layout engine: every getBoundingClientRect() returns all
 * zeros. @floating-ui's collision middleware (flip/shift) measures against real
 * boxes, so with no layout it cannot converge and popover tests hang until they
 * time out.
 *
 * Production keeps flip+shift — without them the popover renders off-screen in
 * vertical mode, where the marked text sits near the right edge (measured:
 * mark x=1412 in a 1512px viewport, popover 320px wide). Only the collision
 * middleware is neutralised here; useFloating, offset and all rendering stay
 * real, so tests still exercise placement plumbing and popover behaviour.
 */
vi.mock("@floating-ui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@floating-ui/react")>();
  const noop = (name: string) => () => ({ name, fn: () => ({}) });
  return { ...actual, flip: noop("flip"), shift: noop("shift") };
});

/*
 * RTL's default async timeout is 1000ms. Under jsdom every annotation mutation
 * round-trips through fake-indexeddb (write, re-read, re-render of 343
 * passages), which routinely exceeds that — so waitFor/findBy would fail on
 * steps that the browser completes in milliseconds. Raising it here keeps those
 * helpers usable; real hangs still fail, just later.
 */
configure({ asyncUtilTimeout: 5000 });

// RTL's automatic cleanup is not registered under Vitest's globals, so without
// this every test leaves its React tree mounted in the shared jsdom document.
// Later tests then fail to find text because of the accumulated DOM.
afterEach(() => {
  cleanup();
});
