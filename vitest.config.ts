import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    dir: "./src",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    /*
     * A volume holds 343 passages and a reader test renders it, dispatches a
     * selection, creates a mark, then re-renders. jsdom plus fake-indexeddb plus
     * act flushing make the heaviest interaction tests (create → write note →
     * save → delete) take ~16s, measured. This is environment cost, not
     * user-visible: the same flows run in ~1s each in a real browser via
     * Playwright. Real hangs still fail, just later.
     */
    testTimeout: 30000,
  },
});
