import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL's automatic cleanup is not registered under Vitest's globals, so without
// this every test leaves its React tree mounted in the shared jsdom document.
// Later tests then fail to find text because of the accumulated DOM.
afterEach(() => {
  cleanup();
});
